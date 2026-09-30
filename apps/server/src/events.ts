import type { Operation, Patch } from '@lacuno/document'

/** An agent's `user` is who connected it, named in gateway mode. */
export type Actor = { kind: 'editor' } | { kind: 'agent'; app: string; user?: string }

/** One committed batch on a site, as the editor's event stream and activity list see it. */
export type SiteEvent = {
  revision: number
  patches: Patch[]
  actor: Actor
  at: number
  summary: string
}

type Listener = (event: SiteEvent) => void

const listeners = new Map<string, Set<Listener>>()
const recent = new Map<string, SiteEvent[]>()
const KEEP = 50

/** In-process fan-out of committed batches per site, with the last few kept for late joiners. */
export const siteEvents = {
  emit(siteId: string, event: SiteEvent) {
    const kept = recent.get(siteId) ?? []
    kept.push(event)
    if (kept.length > KEEP) kept.shift()
    recent.set(siteId, kept)
    for (const listener of listeners.get(siteId) ?? []) listener(event)
  },
  subscribe(siteId: string, listener: Listener): () => void {
    const set = listeners.get(siteId) ?? new Set()
    set.add(listener)
    listeners.set(siteId, set)
    return () => {
      set.delete(listener)
    }
  },
  recent(siteId: string): SiteEvent[] {
    return recent.get(siteId) ?? []
  },
}

/** "12 operations: node.create ×5, style.set ×7", or "3 changes" for a patch-only batch. */
/** What each kind of operation changes, singular and plural, for the activity list. */
const things: Record<string, [string, string]> = {
  node: ['element', 'elements'],
  style: ['style', 'styles'],
  page: ['page', 'pages'],
  folder: ['folder', 'folders'],
  class: ['class', 'classes'],
  designToken: ['design token', 'design tokens'],
  mode: ['mode', 'modes'],
  breakpoint: ['breakpoint', 'breakpoints'],
  asset: ['file', 'files'],
  component: ['component', 'components'],
  collection: ['collection', 'collections'],
  field: ['field', 'fields'],
  entry: ['entry', 'entries'],
  redirect: ['redirect', 'redirects'],
}

/** One operation in words, such as "added an element" or "edited text". */
function phrase(op: Operation) {
  const [group = '', action = ''] = op.type.split('.')
  if (group === 'site') return 'changed the site settings'
  if (op.type === 'node.update' && 'text' in op) return 'edited text'
  const verb = /^(create|add|extract)$/.test(action)
    ? 'added'
    : /^(delete|remove)$/.test(action)
      ? 'removed'
      : action === 'move'
        ? 'moved'
        : 'changed'
  return `${verb} ${group}`
}

/**
 * A batch in plain words for the activity list, largest part first: "Changed 12 styles, added 3
 * elements and edited text". A batch without its operations counts its changes.
 */
export function summarize(operations: Operation[] | undefined, patches: Patch[]): string {
  if (!operations?.length)
    return patches.length === 1 ? 'Made 1 change' : `Made ${patches.length} changes`
  const counts = new Map<string, number>()
  for (const op of operations) counts.set(phrase(op), (counts.get(phrase(op)) ?? 0) + 1)
  const parts = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([text, n]) => {
      const [verb, group = ''] = text.split(' ')
      const thing = things[group]
      if (!thing) return text
      if (n > 1) return `${verb} ${n} ${thing[1]}`
      return `${verb} ${/^[aeiou]/.test(thing[0]) ? 'an' : 'a'} ${thing[0]}`
    })
  const shown = parts.length > 3 ? [...parts.slice(0, 3), 'more'] : parts
  const text = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0]!
  return text[0]!.toUpperCase() + text.slice(1)
}

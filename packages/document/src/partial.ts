import type { Patch, Path } from './patch.js'

/**
 * Patches for a partial update: `undefined` leaves a key alone, `null` deletes it (only when it
 * exists), anything else sets it. Keys are emitted in the order given.
 */
export function partialPatches(
  path: Path,
  values: Record<string, unknown>,
  existing?: object,
): Patch[] {
  const out: Patch[] = []
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (value === null) {
      if (existing === undefined || key in existing)
        out.push({ op: 'delete', path: [...path, key] })
      continue
    }
    out.push({ op: 'set', path: [...path, key], value })
  }
  return out
}

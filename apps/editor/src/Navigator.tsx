import type { Document } from '@freeflow/schema'
import { useEffect, useRef, useState } from 'react'
import { EditorIcon } from './EditorIcon.js'
import type { EditOperation } from './history.js'
import { presetValues } from './presets.js'
import { structureRestriction } from './structure.js'

type Props = {
  doc: Document
  root: string
  selected: string
  reveal: number
  disabled: boolean
  select: (id: string) => void
  actions: (id: string) => void
  save: (operations: EditOperation[]) => Promise<boolean>
  nodeAction: (action: 'duplicate' | 'delete', id: string) => void
}

export function Navigator({
  doc,
  root,
  selected,
  reveal,
  disabled,
  select,
  actions,
  save,
  nodeAction,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () =>
      new Set(
        Object.values(doc.nodes)
          .filter(
            (node) =>
              node.id !== root &&
              !(node.parent === root && node.type === 'element' && node.tag === 'main'),
          )
          .map((node) => node.id),
      ),
  )
  const autoOpened = useRef(new Set<string>())
  const [renaming, setRenaming] = useState('')
  const [name, setName] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const editing = useRef('')
  const childrenOf = (id: string) => {
    const node = doc.nodes[id]
    if (!node) return []
    const component = node.type === 'component' ? doc.components[node.component]?.root : undefined
    return component ? [component, ...node.children] : node.children
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: clicking the current canvas selection must reveal it again.
  useEffect(() => {
    const ancestors = new Set<string>()
    const visit = (id: string, path: string[]): boolean => {
      if (path.includes(id)) return false
      if (id === selected) {
        for (const parent of path) ancestors.add(parent)
        return true
      }
      const node = doc.nodes[id]
      const component =
        node?.type === 'component' ? doc.components[node.component]?.root : undefined
      return [...(component ? [component] : []), ...(node?.children ?? [])].some((child) =>
        visit(child, [...path, id]),
      )
    }
    visit(root, [])
    const previouslyOpened = autoOpened.current
    autoOpened.current = new Set()
    setCollapsed((before) => {
      const next = new Set([...before, ...previouslyOpened])
      for (const id of ancestors) {
        if (next.delete(id)) autoOpened.current.add(id)
      }
      return next
    })
  }, [selected, root, doc, reveal])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reveal the selected row after selection or branch visibility changes.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      panel.current?.querySelector('.layer.selected')?.scrollIntoView({ block: 'nearest' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [selected, collapsed])
  useEffect(() => {
    if (renaming) {
      input.current?.focus()
      input.current?.select()
    }
  }, [renaming])
  const toggle = (id: string) =>
    setCollapsed((before) => {
      autoOpened.current.delete(id)
      const next = new Set(before)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const rename = (id: string) => {
    if (disabled || structureRestriction(doc, id)) return
    editing.current = id
    setRenaming(id)
    setName(
      doc.nodes[id]?.meta?.label ?? ('tag' in doc.nodes[id]! ? doc.nodes[id]!.tag : 'Element'),
    )
  }
  const finish = () => {
    const id = editing.current
    editing.current = ''
    setRenaming('')
    const node = doc.nodes[id]
    if (node && name.trim() && name.trim() !== node.meta?.label)
      void save([{ type: 'node.update', id, meta: { ...node.meta, label: name.trim() } }])
  }
  const render = (id: string, depth: number, path: string[]): React.ReactNode => {
    const node = doc.nodes[id]
    if (!node || path.includes(id) || depth > 50) return null
    const children = childrenOf(id)
    const label =
      node.meta?.label ??
      (id === root
        ? 'Body'
        : 'tag' in node
          ? ((
              {
                div: 'Container',
                section: 'Section',
                p: 'Paragraph',
                h1: 'Heading',
                h2: 'Heading',
                h3: 'Heading',
              } as Record<string, string>
            )[node.tag] ?? node.tag)
          : node.type)
    const values = presetValues(doc, node, {})
    const display = values.display
    const direction = values['flex-direction']
    const layout = display?.type === 'raw' ? display.value : ''
    const kind =
      node.type === 'element' && node.tag === 'img'
        ? 'image'
        : node.type === 'component'
          ? 'component'
          : node.type === 'text'
            ? 'text'
            : node.type === 'element' && node.tag === 'section'
              ? 'section'
              : layout === 'grid'
                ? 'grid'
                : layout === 'flex'
                  ? direction?.type === 'raw' && direction.value.startsWith('column')
                    ? 'stack'
                    : 'row'
                  : 'layer'
    return (
      <div key={id}>
        <div
          className={`navigator-row ${selected === id ? 'active' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <span className="navigator-guides" style={{ width: depth * 14 }} />
          {children.length ? (
            <button
              type="button"
              className="navigator-toggle"
              aria-label={`${collapsed.has(id) ? 'Expand' : 'Collapse'} ${label}`}
              aria-expanded={!collapsed.has(id)}
              onClick={() => toggle(id)}
            >
              <EditorIcon name="chevron" />
            </button>
          ) : (
            <span className="navigator-spacer" />
          )}
          {renaming === id ? (
            <input
              ref={input}
              aria-label="Element name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={finish}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') {
                  event.preventDefault()
                  finish()
                }
                if (event.key === 'Escape') {
                  editing.current = ''
                  setRenaming('')
                }
              }}
            />
          ) : (
            <button
              type="button"
              draggable={!disabled && !structureRestriction(doc, id) && id !== root}
              data-drag-node={id}
              className={`layer ${selected === id ? 'selected' : ''}`}
              title={label}
              aria-current={selected === id ? 'true' : undefined}
              onClick={() => select(id)}
              onDoubleClick={() => rename(id)}
              onContextMenu={(event) => {
                event.preventDefault()
                actions(id)
              }}
              onKeyDown={(event) => {
                if (event.shiftKey && event.key === 'F10') {
                  event.preventDefault()
                  actions(id)
                } else if (event.key === 'F2') {
                  event.preventDefault()
                  rename(id)
                } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
                  event.preventDefault()
                  nodeAction('duplicate', id)
                } else if (event.key === 'Delete' || event.key === 'Backspace') {
                  event.preventDefault()
                  nodeAction('delete', id)
                } else if (event.key === 'ArrowRight' && children.length && collapsed.has(id)) {
                  event.preventDefault()
                  toggle(id)
                } else if (event.key === 'ArrowLeft' && children.length && !collapsed.has(id)) {
                  event.preventDefault()
                  toggle(id)
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const buttons = [
                    ...(panel.current?.querySelectorAll<HTMLButtonElement>('.layer') ?? []),
                  ]
                  buttons[
                    buttons.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)
                  ]?.focus()
                }
              }}
            >
              <span className="layer-icon">
                <EditorIcon name={kind} />
              </span>
              <span className="navigator-name">{label}</span>
              {node.meta?.locked && <span title="Locked">·</span>}
            </button>
          )}
        </div>
        {!collapsed.has(id) && children.map((child) => render(child, depth + 1, [...path, id]))}
      </div>
    )
  }
  return (
    <div className="navigator" ref={panel}>
      <div className="navigator-tools">
        <button
          type="button"
          onClick={() => {
            autoOpened.current.clear()
            setCollapsed(new Set())
          }}
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => {
            autoOpened.current.clear()
            setCollapsed(new Set(Object.keys(doc.nodes).filter((id) => id !== root)))
          }}
        >
          Collapse all
        </button>
      </div>
      {render(root, 0, [])}
    </div>
  )
}

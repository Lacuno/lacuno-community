import type { Operation } from '@lacuno/document'
import type { Document } from '@lacuno/schema'
import { useEffect, useRef, useState } from 'react'
import { EditorIcon } from './EditorIcon.js'
import { Menu, type MenuPoint, menuPoint } from './Menu.js'
import { presetValues } from './presets.js'
import {
  moveShortcut,
  type NodeAction,
  nodeLabel,
  structureRestriction,
  subtreeRestriction,
} from './structure.js'

/** The layer icon for an element's tag; other elements show their layout. */
const tagKinds: Record<string, 'image' | 'video' | 'list' | 'section'> = {
  img: 'image',
  video: 'video',
  ul: 'list',
  ol: 'list',
  section: 'section',
}

type Props = {
  doc: Document
  root: string
  rootLabel?: string
  selected: string
  reveal: number
  disabled: boolean
  select: (id: string) => void
  actions: (id: string) => void
  save: (operations: Operation[]) => Promise<boolean>
  nodeAction: (action: NodeAction, id: string) => void
}

export function Navigator({
  doc,
  root,
  rootLabel,
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
  const [menu, setMenu] = useState<{ id: string; at: MenuPoint }>()
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const childrenOf = (id: string) => {
    const node = doc.nodes[id]
    if (!node) return []
    return node.type === 'component' ? [] : node.children
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
      return childrenOf(id).some((child) => visit(child, [...path, id]))
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
    setRenaming(id)
  }
  const finish = (id: string, value: string) => {
    setRenaming('')
    const node = doc.nodes[id]
    const label = value.trim()
    if (node && label && label !== node.meta?.label)
      void save([{ type: 'node.update', id, meta: { ...node.meta, label } }])
  }
  const render = (id: string, depth: number, path: string[]): React.ReactNode => {
    const node = doc.nodes[id]
    if (!node || path.includes(id) || depth > 50) return null
    const children = childrenOf(id)
    const label =
      (node.type === 'component' ? doc.components[node.component]?.name : undefined) ??
      node.meta?.label ??
      (id === root ? (rootLabel ?? 'Body') : nodeLabel(node))
    const values = presetValues(doc, node, {})
    const display = values.display
    const direction = values['flex-direction']
    const layout = display?.type === 'raw' ? display.value : ''
    const kind =
      node.type === 'embed' || node.type === 'component' || node.type === 'text'
        ? node.type
        : (node.type === 'element' && tagKinds[node.tag]) ||
          (layout === 'grid'
            ? 'grid'
            : layout === 'flex'
              ? direction?.type === 'raw' && direction.value.startsWith('column')
                ? 'stack'
                : 'row'
              : 'layer')
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
              defaultValue={nodeLabel(node)}
              onBlur={(event) => finish(id, event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key !== 'Enter' && event.key !== 'Escape') return
                event.preventDefault()
                // Blur commits; Escape restores the saved name first, so it commits nothing.
                if (event.key === 'Escape') event.currentTarget.value = node.meta?.label ?? ''
                event.currentTarget.blur()
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
                select(id)
                setMenu({ id, at: menuPoint(event) })
              }}
              onKeyDown={(event) => {
                if (event.shiftKey && event.key === 'F10') {
                  event.preventDefault()
                  select(id)
                  setMenu({ id, at: menuPoint(event) })
                } else if (event.key === 'F2') {
                  event.preventDefault()
                  rename(id)
                } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
                  event.preventDefault()
                  nodeAction('duplicate', id)
                } else if (event.key === 'Delete' || event.key === 'Backspace') {
                  event.preventDefault()
                  nodeAction('delete', id)
                } else if (moveShortcut(event)) {
                  event.preventDefault()
                  nodeAction(moveShortcut(event)!, id)
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
      {menu && (
        <Menu
          key={menu.id}
          at={menu.at}
          label="Layer actions"
          close={() => setMenu(undefined)}
          items={[
            { label: 'Element actions…', run: () => actions(menu.id) },
            {
              label: 'Rename',
              disabled: disabled || !!structureRestriction(doc, menu.id),
              run: () => rename(menu.id),
            },
            {
              label: 'Duplicate',
              disabled: disabled || !!subtreeRestriction(doc, menu.id),
              run: () => nodeAction('duplicate', menu.id),
            },
            {
              label: 'Delete',
              danger: true,
              disabled: disabled || !!subtreeRestriction(doc, menu.id),
              run: () => nodeAction('delete', menu.id),
            },
          ]}
        />
      )}
    </div>
  )
}

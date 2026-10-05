import type { Operation } from '@lacuno/document'
import type { Document, ElementNode, Node } from '@lacuno/schema'
import type { KeyboardEvent } from 'react'
import { useConfig } from './api.js'
import { optionNodes, toggleAttr } from './structure.js'

const controls = new Set(['input', 'textarea', 'select'])
const inputTypes = {
  text: 'Text',
  email: 'Email',
  tel: 'Phone',
  number: 'Number',
  url: 'URL',
  date: 'Date',
}

/** What the form settings edit: a form, a field's control, or the control a label wraps. */
export function formTarget(doc: Document, node: Node): ElementNode | undefined {
  if (node.type !== 'element') return undefined
  if (node.tag === 'form' || controls.has(node.tag)) return node
  if (node.tag === 'label')
    return node.children
      .map((id) => doc.nodes[id])
      .find((child): child is ElementNode => child?.type === 'element' && controls.has(child.tag))
}

const enter = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'Enter') event.currentTarget.blur()
}

/** A form's name and success message, or a field's name, type, placeholder, options and flag. */
export function FormControls({
  doc,
  node,
  disabled,
  save,
}: {
  doc: Document
  node: ElementNode
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
}) {
  const { config } = useConfig()
  const value = (name: string) => {
    const binding = node.attrs?.[name]
    return binding?.type === 'static' ? String(binding.value) : ''
  }
  const setValue = (name: string, next: string) => {
    if (next === value(name)) return
    const attrs = { ...node.attrs }
    if (next) attrs[name] = { type: 'static', value: next }
    else delete attrs[name]
    void save([{ type: 'node.update', id: node.id, attrs }])
  }
  // Saved when the field is left; the key resets it when the value changes elsewhere.
  const text = (label: string, name: string) => (
    <label key={`${name}:${value(name)}`}>
      {label}
      <input
        aria-label={label}
        defaultValue={value(name)}
        disabled={disabled}
        onBlur={(event) => setValue(name, event.target.value)}
        onKeyDown={enter}
      />
    </label>
  )
  if (node.tag === 'form')
    return (
      <div className="form-controls">
        {text('Form name', 'data-lacuno-form')}
        {text('Success message', 'data-success')}
        <p className="hint">
          {config?.forms === false
            ? 'Submissions are off on this server: set LACUNO_SMTP_URL.'
            : 'Submissions are emailed to the workspace owner.'}
        </p>
      </div>
    )
  const checkbox = value('type') === 'checkbox'
  const options = node.children.map((id) => {
    const option = doc.nodes[id]
    return option?.type === 'text' && option.text.type === 'static' ? String(option.text.value) : ''
  })
  return (
    <div className="form-controls">
      {text('Field name', 'name')}
      {node.tag === 'input' && !checkbox && (
        <label>
          Type
          <select
            aria-label="Field type"
            disabled={disabled}
            value={value('type') || 'text'}
            onChange={(event) => setValue('type', event.target.value)}
          >
            {Object.entries(inputTypes).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {node.tag !== 'select' && !checkbox && text('Placeholder', 'placeholder')}
      {node.tag === 'select' && (
        <label key={options.join('\n')}>
          Options
          <textarea
            aria-label="Options"
            rows={4}
            defaultValue={options.join('\n')}
            disabled={disabled}
            onBlur={(event) => {
              const next = event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
              if (next.join('\n') === options.join('\n')) return
              void save([
                ...node.children.map((id) => ({ type: 'node.delete' as const, id })),
                ...optionNodes(next).map((option, index) => ({
                  type: 'node.create' as const,
                  parent: node.id,
                  index,
                  node: option,
                })),
              ])
            }}
          />
        </label>
      )}
      <label className="form-required">
        <input
          type="checkbox"
          disabled={disabled}
          checked={node.attrs?.required?.type === 'static' && node.attrs.required.value === true}
          onChange={(event) => void save([toggleAttr(node, 'required', event.target.checked)])}
        />
        Required
      </label>
    </div>
  )
}

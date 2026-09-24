import type {
  AssetRef,
  Binding,
  CollectionSchema,
  Component,
  Document,
  Entry,
  NodeId,
  RichText,
} from '@miralo/schema'
import { designTokenCssName } from '@miralo/schema'
import { RenderError } from './errors.js'

/** One component instance being rendered. Slot children render in the outer scope. */
export type Frame = {
  instance: NodeId
  component: Component
  values: Record<string, unknown>
  slots: Map<string, NodeId[]>
  outer: Scope
}

export type Scope = {
  entry?: Entry
  collection?: CollectionSchema
  frames: Frame[]
}

export type Resolved = string | number | boolean | RichText | AssetRef | undefined

export function resolveBinding(doc: Document, b: Binding, scope: Scope, nodeId: string): Resolved {
  switch (b.type) {
    case 'static':
      return b.value
    case 'designToken': {
      const t = doc.designTokens[b.designToken]
      if (!t) throw new RenderError(`unknown design token ${b.designToken}`, nodeId)
      return `var(${designTokenCssName(t.name)})`
    }
    case 'asset': {
      const a = doc.assets[b.asset]
      if (!a) throw new RenderError(`unknown asset ${b.asset}`, nodeId)
      return a
    }
    case 'field': {
      if (!scope.entry || !scope.collection)
        throw new RenderError(`field binding ${b.field} outside a collection`, nodeId)
      if (!scope.collection.fields.some((f) => f.id === b.field))
        throw new RenderError(`unknown field ${b.field}`, nodeId)
      return scope.entry.fields[b.field] as Resolved
    }
    case 'page': {
      const p = doc.pages[b.page]
      if (!p) throw new RenderError(`unknown page ${b.page}`, nodeId)
      // Validation keeps page bindings off collection pages, so this is a real address.
      return p.path
    }
    case 'prop': {
      const frame = scope.frames[scope.frames.length - 1]
      if (!frame) throw new RenderError('prop binding outside a component', nodeId)
      const def = frame.component.props.find((p) => p.name === b.prop)
      if (!def) throw new RenderError(`unknown prop ${b.prop}`, nodeId)
      const v = frame.values[b.prop]
      return (v === undefined ? def.default : v) as Resolved
    }
  }
}

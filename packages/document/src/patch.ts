import { PatchError } from './errors.js'

export type PathSegment = string | number
export type Path = PathSegment[]

/**
 * The five primitives every operation compiles to. Each maps onto one Yjs map or array call,
 * which is why reordering is a `move` and never a `remove` plus `insert`.
 */
export type Patch =
  | { op: 'set'; path: Path; value: unknown }
  | { op: 'delete'; path: Path }
  | { op: 'insert'; path: Path; index: number; value: unknown }
  | { op: 'remove'; path: Path; index: number }
  | { op: 'move'; path: Path; from: number; to: number }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Returns a copy of `node` with the container at `path` replaced by `edit(container)`. Only
 * containers along the path are copied. With `create`, missing objects along the path are made.
 */
function update(
  node: unknown,
  path: Path,
  depth: number,
  create: boolean,
  patch: Patch,
  edit: (container: unknown) => unknown,
): unknown {
  if (depth === path.length) return edit(node)
  const key = path[depth] as PathSegment
  if (Array.isArray(node)) {
    if (typeof key !== 'number' || key < 0 || key >= node.length)
      throw new PatchError(`array index ${String(key)} out of range at depth ${depth}`, patch)
    const copy = node.slice()
    copy[key] = update(node[key], path, depth + 1, create, patch, edit)
    return copy
  }
  if (node === undefined && create) node = {}
  if (!isObject(node))
    throw new PatchError(`path segment ${String(key)} at depth ${depth} is not a container`, patch)
  const k = String(key)
  if (!(k in node) && !create) throw new PatchError(`missing key ${k} at depth ${depth}`, patch)
  return { ...node, [k]: update(node[k], path, depth + 1, create, patch, edit) }
}

function arrayAt(container: unknown, patch: Patch): unknown[] {
  if (!Array.isArray(container)) throw new PatchError('target is not an array', patch)
  return container
}

function applyOne(root: unknown, patch: Patch): unknown {
  switch (patch.op) {
    case 'set': {
      const parent = patch.path.slice(0, -1)
      const last = patch.path[patch.path.length - 1]
      if (last === undefined) return patch.value
      return update(root, parent, 0, true, patch, (container) => {
        if (Array.isArray(container)) {
          if (typeof last !== 'number' || last < 0 || last >= container.length)
            throw new PatchError(`set index ${String(last)} out of range`, patch)
          const copy = container.slice()
          copy[last] = patch.value
          return copy
        }
        const obj = container === undefined ? {} : container
        if (!isObject(obj)) throw new PatchError('set target is not an object', patch)
        return { ...obj, [String(last)]: patch.value }
      })
    }
    case 'delete': {
      const parent = patch.path.slice(0, -1)
      const last = String(patch.path[patch.path.length - 1])
      return update(root, parent, 0, false, patch, (container) => {
        if (!isObject(container) || !(last in container))
          throw new PatchError(`no key ${last} to delete`, patch)
        const { [last]: _removed, ...rest } = container
        return rest
      })
    }
    case 'insert':
      return update(root, patch.path, 0, false, patch, (container) => {
        const arr = arrayAt(container, patch)
        if (patch.index < 0 || patch.index > arr.length)
          throw new PatchError(`insert index ${patch.index} out of range`, patch)
        const copy = arr.slice()
        copy.splice(patch.index, 0, patch.value)
        return copy
      })
    case 'remove':
      return update(root, patch.path, 0, false, patch, (container) => {
        const arr = arrayAt(container, patch)
        if (patch.index < 0 || patch.index >= arr.length)
          throw new PatchError(`remove index ${patch.index} out of range`, patch)
        const copy = arr.slice()
        copy.splice(patch.index, 1)
        return copy
      })
    case 'move':
      return update(root, patch.path, 0, false, patch, (container) => {
        const arr = arrayAt(container, patch)
        if (patch.from < 0 || patch.from >= arr.length || patch.to < 0 || patch.to >= arr.length)
          throw new PatchError(`move ${patch.from} to ${patch.to} out of range`, patch)
        const copy = arr.slice()
        const [item] = copy.splice(patch.from, 1)
        copy.splice(patch.to, 0, item)
        return copy
      })
  }
}

/** Applies patches in order with structural sharing. Never mutates `root`. */
export function applyPatches<T>(root: T, patches: readonly Patch[]): T {
  let current: unknown = root
  for (const patch of patches) current = applyOne(current, patch)
  return current as T
}

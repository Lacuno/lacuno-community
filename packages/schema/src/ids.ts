import { z } from 'zod'

/**
 * Every entity in the document has a stable, opaque id. Ids are short random strings, never
 * derived from names, so renames and moves never break references, multiplayer edits or agent
 * tool calls that captured an id earlier.
 */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * True for strings that would silently pass through as Object.prototype property names
 * (`constructor`, `toString`, `hasOwnProperty`, `valueOf`, ...), which the `in` operator finds
 * on any plain object even when no own property was ever set. Code that tests existence with
 * `map[id]` truthiness instead of `id in map` or `Object.hasOwn` would treat such an id as
 * always present, so we refuse them at the id schema itself.
 */
export function isReservedId(id: string): boolean {
  return id in Object.prototype
}

const id = (name: string) =>
  z
    .string()
    .regex(ID_PATTERN, `${name}: invalid id`)
    .refine((s) => !isReservedId(s), `${name}: reserved id`)

export const NodeId = id('NodeId')
export const PageId = id('PageId')
export const ClassId = id('ClassId')
export const BreakpointId = id('BreakpointId')
export const DesignTokenId = id('DesignTokenId')
export const ModeId = id('ModeId')
export const ComponentId = id('ComponentId')
export const CollectionId = id('CollectionId')
export const FieldId = id('FieldId')
export const AssetId = id('AssetId')
export const FolderId = id('FolderId')
export const EntryId = id('EntryId')

export type NodeId = z.infer<typeof NodeId>
export type PageId = z.infer<typeof PageId>
export type ClassId = z.infer<typeof ClassId>
export type BreakpointId = z.infer<typeof BreakpointId>
export type DesignTokenId = z.infer<typeof DesignTokenId>
export type ModeId = z.infer<typeof ModeId>
export type ComponentId = z.infer<typeof ComponentId>
export type CollectionId = z.infer<typeof CollectionId>
export type FieldId = z.infer<typeof FieldId>
export type AssetId = z.infer<typeof AssetId>
export type FolderId = z.infer<typeof FolderId>
export type EntryId = z.infer<typeof EntryId>

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Generates a 12 character id. Uses the Web Crypto API, available in Node 22 and browsers. */
export function newId(): string {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

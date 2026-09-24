import type { Document } from '@freeflow/schema'

/** Where a document and its asset bytes live. Phase 1's server supplies SQLite and git here. */
export interface Persistence {
  /** Raw JSON of the stored document, or undefined when nothing is stored yet. */
  load(): Promise<unknown>
  save(document: Document): Promise<void>
  putAsset(bytes: Uint8Array, hash: string): Promise<void>
}

export class MemoryPersistence implements Persistence {
  saved: Document | undefined
  readonly assets = new Map<string, Uint8Array>()
  constructor(private initial?: unknown) {}
  async load(): Promise<unknown> {
    return this.saved ?? (this.initial === undefined ? undefined : structuredClone(this.initial))
  }
  async save(document: Document): Promise<void> {
    this.saved = document
  }
  async putAsset(bytes: Uint8Array, hash: string): Promise<void> {
    this.assets.set(hash, bytes)
  }
}

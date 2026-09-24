import type { Document } from '@freeflow/schema'
import type { AssetPersistence } from './routes.js'

/** Resolves an IndexedDB request with its result. */
const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

/**
 * The browser site in IndexedDB: the document under one key and asset bytes by hash. Until the
 * first save it is the template, whose asset bytes are fetched from `/template/<hash>` when first
 * asked for and kept.
 */
export class IdbPersistence implements AssetPersistence {
  private db: Promise<IDBDatabase>
  constructor(private template: unknown) {
    const request = indexedDB.open('freeflow-try', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('document')
      request.result.createObjectStore('assets')
    }
    // Closes when the site is deleted, so a deletion from another page or the worker is not blocked.
    this.db = done(request).then((db) => {
      db.onversionchange = () => db.close()
      return db
    })
  }
  private async store(name: 'document' | 'assets', mode: IDBTransactionMode = 'readonly') {
    return (await this.db).transaction(name, mode).objectStore(name)
  }
  async load(): Promise<unknown> {
    return (await done((await this.store('document')).get('document'))) ?? this.template
  }
  async save(document: Document): Promise<void> {
    await done((await this.store('document', 'readwrite')).put(document, 'document'))
  }
  async putAsset(bytes: Uint8Array, hash: string): Promise<void> {
    await done((await this.store('assets', 'readwrite')).put(bytes, hash))
  }
  async delete(): Promise<void> {
    await done(indexedDB.deleteDatabase('freeflow-try'))
  }
  async getAsset(hash: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const stored = await done((await this.store('assets')).get(hash))
    if (stored) return stored
    const response = await fetch(`/template/${hash}`)
    if (!response.ok) return undefined
    const bytes = new Uint8Array(await response.arrayBuffer())
    await this.putAsset(bytes, hash)
    return bytes
  }
}

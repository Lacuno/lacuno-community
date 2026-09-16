import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Document } from '@freeflow/schema'
import { DocumentError } from '@freeflow/schema'
import { serializeDocument } from './serialize.js'

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

/** Writes to a sibling temp file and renames over the target, so a crash leaves the old file. */
async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

export class FolderPersistence implements Persistence {
  readonly file: string
  readonly assetsDir: string
  constructor(readonly siteDir: string) {
    this.file = path.join(siteDir, 'freeflow.json')
    this.assetsDir = path.join(siteDir, 'assets')
  }
  async load(): Promise<unknown> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw e
    }
    try {
      return JSON.parse(text)
    } catch (e) {
      throw new DocumentError([
        { path: 'freeflow.json', message: `not valid JSON: ${(e as Error).message}` },
      ])
    }
  }
  async save(document: Document): Promise<void> {
    await mkdir(this.siteDir, { recursive: true })
    await writeAtomic(this.file, serializeDocument(document))
  }
  async putAsset(bytes: Uint8Array, hash: string): Promise<void> {
    await mkdir(this.assetsDir, { recursive: true })
    const target = path.join(this.assetsDir, hash)
    try {
      await stat(target)
      return // identical bytes already stored
    } catch {
      await writeAtomic(target, bytes)
    }
  }
}

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Document } from '@freeflow/schema'
import { createEmptyDocument, DocumentError } from '@freeflow/schema'
import type { Persistence } from './persistence.js'
import { serializeDocument } from './serialize.js'
import { DocumentStore } from './store.js'

/** Writes to a sibling temp file and renames over the target, so a crash leaves the old file. */
async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, data, { flag: 'wx' })
    await rename(tmp, file)
  } finally {
    await rm(tmp, { force: true })
  }
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await writeAtomic(target, bytes)
    }
  }
}

/** A missing folder holds no freeflow.json, so load() reports it as no document found. */
export function openFolder(siteDir: string): Promise<DocumentStore> {
  return DocumentStore.withPersistence(new FolderPersistence(path.resolve(siteDir)))
}

export async function createFolder(siteDir: string, name: string): Promise<DocumentStore> {
  const dir = path.resolve(siteDir)
  await mkdir(dir, { recursive: true })
  const persistence = new FolderPersistence(dir)
  // A file that fails to parse is still a file the user may want to recover by hand; let
  // load()'s DocumentError propagate rather than silently overwriting it.
  const existing = await persistence.load()
  if (existing !== undefined)
    throw new DocumentError([
      { path: 'freeflow.json', message: 'a document already exists in this folder' },
    ])
  await persistence.save(createEmptyDocument(name))
  return DocumentStore.withPersistence(persistence)
}

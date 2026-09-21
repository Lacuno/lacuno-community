import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { AssetRef, Document } from '@freeflow/schema'
import { createEmptyDocument, DocumentError, hashAsset, parseDocument } from '@freeflow/schema'
import type { Warning } from './context.js'
import { planBatch } from './engine.js'
import { RevisionRewoundError, StaleRevisionError } from './errors.js'
import { deepFreeze } from './freeze.js'
import { OPERATIONS_BY_TYPE, type Operation } from './operations/index.js'
import { applyPatches, type Patch } from './patch.js'
import { FolderPersistence, MemoryPersistence, type Persistence } from './persistence.js'

/** Either named operations to plan, or the patches of an earlier commit to replay: never both. */
export type Batch = {
  /** The revision the caller read. A different current revision rejects the batch. */
  expectedRevision: number
  /** Plan and validate, return the patches, commit nothing. */
  dryRun?: boolean
} & ({ operations: Operation[]; patches?: never } | { patches: Patch[]; operations?: never })

export type ApplyResult = {
  /** The new revision, or the unchanged one for a dry run. */
  revision: number
  patches: Patch[]
  /** Operation index to the ids that operation generated. */
  created: Record<number, string[]>
  warnings: Warning[]
}

/** Highest revision seen per site folder in this process, to refuse a file that went backwards. */
const seenRevisions = new Map<string, number>()

export function kindForMime(mime: string): AssetRef['kind'] {
  if (mime === 'image/svg+xml') return 'svg'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('font/') || mime.startsWith('application/font')) return 'font'
  return 'file'
}

/**
 * Owns one document and its revision. All mutation goes through apply(); the revision is
 * bumped only here, on commit, so no caller can forget it.
 */
export class DocumentStore {
  private document: Document
  /** Serializes apply() calls so overlapping callers cannot both plan from the same revision. */
  private queue: Promise<unknown> = Promise.resolve()
  private constructor(
    private readonly persistence: Persistence,
    document: Document,
    private readonly key?: string,
  ) {
    this.document = deepFreeze(document)
  }

  static async withPersistence(persistence: Persistence, key?: string): Promise<DocumentStore> {
    const raw = await persistence.load()
    if (raw === undefined)
      throw new DocumentError([{ path: 'freeflow.json', message: 'no document found' }])
    const document = parseDocument(raw)
    if (key !== undefined) {
      const seen = seenRevisions.get(key)
      if (seen !== undefined && document.revision < seen)
        throw new RevisionRewoundError(seen, document.revision)
      seenRevisions.set(key, document.revision)
    }
    return new DocumentStore(persistence, document, key)
  }

  static async open(siteDir: string): Promise<DocumentStore> {
    const dir = path.resolve(siteDir)
    let key: string
    try {
      key = await realpath(dir)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new DocumentError([{ path: 'freeflow.json', message: 'no document found' }])
      throw e
    }
    return DocumentStore.withPersistence(new FolderPersistence(dir), key)
  }

  static async create(siteDir: string, name: string): Promise<DocumentStore> {
    const dir = path.resolve(siteDir)
    await mkdir(dir, { recursive: true })
    const key = await realpath(dir)
    const persistence = new FolderPersistence(dir)
    // A file that fails to parse is still a file the user may want to recover by hand; let
    // load()'s DocumentError propagate rather than silently overwriting it.
    const existing = await persistence.load()
    if (existing !== undefined)
      throw new DocumentError([
        { path: 'freeflow.json', message: 'a document already exists in this folder' },
      ])
    await persistence.save(createEmptyDocument(name))
    return DocumentStore.withPersistence(persistence, key)
  }

  static inMemory(document: Document): DocumentStore {
    return new DocumentStore(new MemoryPersistence(), parseDocument(structuredClone(document)))
  }

  get revision(): number {
    return this.document.revision
  }

  read(): { document: Document; revision: number } {
    return { document: this.document, revision: this.document.revision }
  }

  /** Queues onto any batch already in flight, so overlapping callers never race the revision. */
  apply(batch: Batch): Promise<ApplyResult> {
    return this.enqueue(() => this.applyNow(batch))
  }

  /** Runs `fn` after any batch already in flight, serializing overlapping callers. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applyNow(batch: Batch): Promise<ApplyResult> {
    if (batch.expectedRevision !== this.document.revision)
      throw new StaleRevisionError(batch.expectedRevision, this.document.revision)
    const { operations, patches } = batch
    if ((operations === undefined) === (patches === undefined))
      throw new DocumentError([{ path: 'batch', message: 'send either operations or patches' }])
    // Replayed patches (an editor undo) skip planning, but parseDocument below still gates them.
    const planned = patches
      ? { document: applyPatches(this.document, patches), patches, created: {}, warnings: [] }
      : planBatch(this.document, operations!, OPERATIONS_BY_TYPE)
    const validated = parseDocument(planned.document)
    const base = { patches: planned.patches, created: planned.created, warnings: planned.warnings }
    if (batch.dryRun) return { revision: this.document.revision, ...base }
    const next = applyPatches(validated, [
      { op: 'set', path: ['revision'], value: this.document.revision + 1 },
    ])
    await this.persistence.save(next)
    this.document = deepFreeze(next)
    if (this.key !== undefined) seenRevisions.set(this.key, next.revision)
    return { revision: next.revision, ...base }
  }

  /** The only way bytes enter: hash, store, then register the asset in one committed batch. */
  async importAsset(input: {
    name: string
    mime: string
    bytes: Uint8Array
    alt?: string
    width?: number
    height?: number
  }): Promise<AssetRef> {
    const hash = await hashAsset(input.bytes)
    await this.persistence.putAsset(input.bytes, hash)
    const operation: Operation = {
      type: 'asset.create',
      name: input.name,
      kind: kindForMime(input.mime),
      hash,
      mime: input.mime,
      size: input.bytes.byteLength,
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.alt !== undefined ? { alt: input.alt } : {}),
    }
    const result = await this.enqueue(() =>
      this.applyNow({ expectedRevision: this.document.revision, operations: [operation] }),
    )
    const id = result.created[0]?.[0]
    if (id === undefined) throw new Error('asset.create did not register an asset')
    const asset = this.document.assets[id]
    if (asset === undefined) throw new Error('asset.create did not register an asset')
    return asset
  }
}

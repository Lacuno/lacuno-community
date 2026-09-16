import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocumentError, fixtureDocument } from '@freeflow/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { OperationError, RevisionRewoundError, StaleRevisionError } from '../src/errors.js'
import { MemoryPersistence } from '../src/persistence.js'
import { DocumentStore, kindForMime } from '../src/store.js'

const dirs: string[] = []
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), 'freeflow-store-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('DocumentStore in memory', () => {
  it('applies a batch, bumps the revision, and hands out frozen documents', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    expect(store.revision).toBe(0)
    const before = store.read().document
    const result = await store.apply({
      expectedRevision: 0,
      operations: [{ type: 'class.create', id: 'c-new', name: 'new' }],
    })
    expect(result.revision).toBe(1)
    expect(result.created[0]).toEqual(['c-new'])
    expect(result.patches).toHaveLength(1)
    const { document, revision } = store.read()
    expect(revision).toBe(1)
    expect(document.revision).toBe(1)
    expect(document.classes['c-new']).toBeDefined()
    expect(before.classes['c-new']).toBeUndefined()
    expect(Object.isFrozen(document)).toBe(true)
    expect(Object.isFrozen(document.nodes)).toBe(true)
  })

  it('rejects stale revisions', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    await store.apply({ expectedRevision: 0, operations: [] })
    await expect(store.apply({ expectedRevision: 0, operations: [] })).rejects.toBeInstanceOf(
      StaleRevisionError,
    )
    try {
      await store.apply({ expectedRevision: 5, operations: [] })
    } catch (e) {
      expect(e).toMatchObject({ expected: 5, current: 1 })
    }
  })

  it('is atomic: a failing later operation leaves nothing applied', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    await expect(
      store.apply({
        expectedRevision: 0,
        operations: [
          { type: 'class.create', id: 'c-new', name: 'new' },
          { type: 'class.create', id: 'c-two', name: 'two' },
          { type: 'class.delete', id: 'c-button' },
        ],
      }),
    ).rejects.toMatchObject({ index: 2 })
    expect(store.revision).toBe(0)
    expect(store.read().document.classes['c-new']).toBeUndefined()
  })

  it('dry runs return patches without committing; empty batches still bump on commit', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const dry = await store.apply({
      expectedRevision: 0,
      dryRun: true,
      operations: [{ type: 'node.delete', id: 'n-hero' }],
    })
    expect(dry.revision).toBe(0)
    expect(dry.patches).toHaveLength(6)
    expect(store.read().document.nodes['n-hero']).toBeDefined()
    const empty = await store.apply({ expectedRevision: 0, operations: [] })
    expect(empty.revision).toBe(1)
    expect(empty.patches).toEqual([])
  })

  it('runs the full referential check on the result', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    // A node literal with a parent link to a slot of another component is valid per operation
    // but a page root with a parent is not; simulate by forging a raw operation the planner
    // accepts and the validator rejects: an entry whose slug field is fine but a design token
    // whose value references a mode that is deleted later in the same batch.
    await expect(
      store.apply({
        expectedRevision: 0,
        operations: [
          {
            type: 'designToken.create',
            id: 't-x',
            name: 'x',
            group: 'other',
            values: { light: { type: 'unit', value: 1, unit: 'px' } },
          },
          { type: 'mode.create', id: 'sepia', label: 'Sepia' },
          {
            type: 'designToken.setValue',
            id: 't-x',
            mode: 'sepia',
            value: { type: 'unit', value: 2, unit: 'px' },
          },
          { type: 'mode.delete', id: 'sepia' },
        ],
      }),
    ).rejects.toBeInstanceOf(OperationError)
    expect(store.revision).toBe(0)
  })

  it('does not commit when persistence fails', async () => {
    const persistence = new MemoryPersistence(fixtureDocument())
    persistence.save = async () => {
      throw new Error('disk full')
    }
    const store = await DocumentStore.withPersistence(persistence)
    await expect(store.apply({ expectedRevision: 0, operations: [] })).rejects.toThrow('disk full')
    expect(store.revision).toBe(0)
  })
})

describe('DocumentStore on a folder', () => {
  it('creates, persists deterministically, reopens, and imports assets', async () => {
    const dir = await tmp()
    const store = await DocumentStore.create(dir, 'Site')
    expect(existsSync(path.join(dir, 'freeflow.json'))).toBe(true)
    await store.apply({
      expectedRevision: 0,
      operations: [{ type: 'site.update', name: 'Renamed' }],
    })
    const text = await readFile(path.join(dir, 'freeflow.json'), 'utf8')
    expect(text).toContain('"name": "Renamed"')
    expect(text).toContain('"revision": 1')
    expect(await readdir(dir)).toEqual(['freeflow.json'])

    const asset = await store.importAsset({
      name: 'note.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode('hi'),
    })
    expect(asset).toMatchObject({ name: 'note.txt', kind: 'file', mime: 'text/plain', size: 2 })
    expect(existsSync(path.join(dir, 'assets', asset.hash))).toBe(true)
    expect(store.revision).toBe(2)

    const again = await DocumentStore.open(dir)
    expect(again.revision).toBe(2)
    expect(again.read().document.site.name).toBe('Renamed')
    expect(again.read().document.assets[asset.id]).toEqual(asset)
  })

  it('refuses a missing or invalid document and a rewound revision', async () => {
    const dir = await tmp()
    await expect(DocumentStore.open(dir)).rejects.toBeInstanceOf(DocumentError)
    await writeFile(path.join(dir, 'freeflow.json'), '{')
    await expect(DocumentStore.open(dir)).rejects.toBeInstanceOf(DocumentError)
    const store = await DocumentStore.create(dir, 'Site')
    await store.apply({ expectedRevision: 0, operations: [] })
    const text = await readFile(path.join(dir, 'freeflow.json'), 'utf8')
    await writeFile(path.join(dir, 'freeflow.json'), text.replace('"revision": 1', '"revision": 0'))
    await expect(DocumentStore.open(dir)).rejects.toBeInstanceOf(RevisionRewoundError)
  })
})

describe('kindForMime', () => {
  it('maps mime types to asset kinds', () => {
    expect(kindForMime('image/png')).toBe('image')
    expect(kindForMime('image/svg+xml')).toBe('svg')
    expect(kindForMime('video/mp4')).toBe('video')
    expect(kindForMime('font/woff2')).toBe('font')
    expect(kindForMime('application/pdf')).toBe('file')
  })
})

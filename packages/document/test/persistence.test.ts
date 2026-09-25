import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { hashAsset } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { FolderPersistence } from '../src/folder.js'

it('concurrent writes of identical assets leave exactly one file with the right bytes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-assets-race-'))
  try {
    const persistence = new FolderPersistence(dir)
    const bytes = new TextEncoder().encode('Shared upload')
    const hash = await hashAsset(bytes)
    await Promise.all(Array.from({ length: 12 }, () => persistence.putAsset(bytes, hash)))
    expect(await readdir(path.join(dir, 'assets'))).toEqual([hash])
    expect(await readFile(path.join(dir, 'assets', hash), 'utf8')).toBe('Shared upload')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

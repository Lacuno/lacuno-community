import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { hashAsset } from '@freeflow/schema'
import { expect, it, vi } from 'vitest'
import { FolderPersistence } from '../src/persistence.js'

it('concurrent identical assets have independent temporary files, even in the same millisecond', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-assets-race-'))
  const now = vi.spyOn(Date, 'now').mockReturnValue(123456789)
  try {
    const persistence = new FolderPersistence(dir)
    const bytes = new TextEncoder().encode('Shared upload')
    const hash = await hashAsset(bytes)
    await Promise.all(Array.from({ length: 12 }, () => persistence.putAsset(bytes, hash)))
    expect(await readdir(path.join(dir, 'assets'))).toEqual([hash])
    expect(await readFile(path.join(dir, 'assets', hash), 'utf8')).toBe('Shared upload')
  } finally {
    now.mockRestore()
    await rm(dir, { recursive: true, force: true })
  }
})

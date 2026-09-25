import { fixtureDocument, hashAsset } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { MemoryPersistence } from '../src/persistence.js'
import { stageUpload } from '../src/upload.js'

const bytes = (head: string | number[]) =>
  new Uint8Array([
    ...(typeof head === 'string' ? new TextEncoder().encode(head) : head),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ])

it('types uploads by their first bytes and stores them', async () => {
  for (const [head, mime] of [
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
    [[0xff, 0xd8, 0xff], 'image/jpeg'],
    ['GIF87a', 'image/gif'],
    ['GIF89a', 'image/gif'],
    ['RIFF\0\0\0\0WEBP', 'image/webp'],
    ['\0\0\0\x18ftypisom', 'video/mp4'],
    [[0x1a, 0x45, 0xdf, 0xa3], 'video/webm'],
    ['wOF2', 'font/woff2'],
    ['wOFF', 'font/woff'],
    [[0, 1, 0, 0], 'font/ttf'],
    ['true', 'font/ttf'],
    ['OTTO', 'font/otf'],
  ] as const) {
    const persistence = new MemoryPersistence()
    const upload = bytes(head as string | number[])
    const { status, body } = await stageUpload(fixtureDocument(), persistence, 'file', upload)
    expect(status).toBe(200)
    expect(body).toMatchObject({ mime, name: 'file', size: upload.length })
    expect(persistence.assets.get(await hashAsset(upload))).toBe(upload)
  }
})

it('refuses empty, oversized and unknown uploads and returns an asset already present', async () => {
  const doc = fixtureDocument()
  const persistence = new MemoryPersistence()
  expect((await stageUpload(doc, persistence, 'f', new Uint8Array())).status).toBe(413)
  expect(
    (await stageUpload(doc, persistence, 'f', new Uint8Array(10 * 1024 * 1024 + 1))).status,
  ).toBe(413)
  expect((await stageUpload(doc, persistence, 'f', bytes('<svg>'))).status).toBe(415)
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const existing = Object.values(doc.assets)[0]!
  existing.hash = await hashAsset(png)
  expect(await stageUpload(doc, persistence, 'f', png)).toEqual({ status: 200, body: existing })
  expect(persistence.assets.size).toBe(0)
})

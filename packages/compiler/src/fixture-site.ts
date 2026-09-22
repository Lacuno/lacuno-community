import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type Document, fixtureDocument, hashAsset } from '@freeflow/schema'
import sharp from 'sharp'

/**
 * The fixture document as a site folder: `freeflow.json` plus a generated hero PNG and a stub MP4
 * under `assets/<sha256>`. Used by the build integration test, the Lighthouse script and, later,
 * as the seed for template work.
 */
export async function writeFixtureSite(dir: string): Promise<Document> {
  const png = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#3b5bdb' },
  })
    .png()
    .toBuffer()
  const mp4 = Buffer.from('\0\0\0\x18ftypisom\0\0\x02\0isomiso2mp41')
  const doc = fixtureDocument()
  await mkdir(path.join(dir, 'assets'), { recursive: true })
  for (const [id, bytes] of [
    ['a-hero', png],
    ['a-clip', mp4],
  ] as const) {
    const asset = doc.assets[id]
    if (!asset) throw new Error(`fixture has no ${id} asset`)
    asset.hash = await hashAsset(bytes)
    asset.size = bytes.length
    await writeFile(path.join(dir, 'assets', asset.hash), bytes)
  }
  await writeFile(path.join(dir, 'freeflow.json'), `${JSON.stringify(doc, null, 2)}\n`)
  return doc
}

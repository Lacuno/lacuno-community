import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type Document, fixtureDocument, hashAsset } from '@freeflow/schema'
import sharp from 'sharp'

/**
 * The fixture document as a site folder: `freeflow.json` plus a generated hero PNG, a stub MP4
 * and two stub WOFF2 files under `assets/<sha256>`. Used by the build integration test, the
 * Lighthouse script and, later, as the seed for template work.
 */
export async function writeFixtureSite(dir: string): Promise<Document> {
  const bytes = await fixtureAssetBytes()
  const doc = fixtureDocument()
  await mkdir(path.join(dir, 'assets'), { recursive: true })
  for (const [id, data] of Object.entries(bytes)) {
    const asset = doc.assets[id]
    if (!asset) throw new Error(`fixture has no ${id} asset`)
    asset.hash = await hashAsset(data)
    asset.size = data.length
    await writeFile(path.join(dir, 'assets', asset.hash), data)
  }
  await writeFile(path.join(dir, 'freeflow.json'), `${JSON.stringify(doc, null, 2)}\n`)
  return doc
}

/** The fixture's asset bytes by asset id: a generated hero PNG, a stub MP4 and two stub WOFF2. */
export async function fixtureAssetBytes() {
  const woff2 = (n: number) => Buffer.from(`wOF2${'\0'.repeat(n)}`)
  return {
    'a-hero': await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#3b5bdb' },
    })
      .png()
      .toBuffer(),
    'a-clip': Buffer.from('\0\0\0\x18ftypisom\0\0\x02\0isomiso2mp41'),
    'a-sans': woff2(8),
    'a-sans-bold': woff2(12),
  }
}

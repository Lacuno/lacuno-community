import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type Document, fixtureDocument, hashAsset } from '@freeflow/schema'
import sharp from 'sharp'

/**
 * The fixture document as a site folder: `freeflow.json` plus a generated hero PNG under
 * `assets/<sha256>`. Used by the build integration test, the Lighthouse script and, later,
 * as the seed for template work.
 */
export async function writeFixtureSite(dir: string): Promise<Document> {
  const png = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#3b5bdb' },
  })
    .png()
    .toBuffer()
  const hash = await hashAsset(png)
  const doc = fixtureDocument()
  const hero = doc.assets['a-hero']
  if (!hero) throw new Error('fixture has no a-hero asset')
  hero.hash = hash
  hero.size = png.length
  await mkdir(path.join(dir, 'assets'), { recursive: true })
  await writeFile(path.join(dir, 'assets', hash), png)
  await writeFile(path.join(dir, 'freeflow.json'), `${JSON.stringify(doc, null, 2)}\n`)
  return doc
}

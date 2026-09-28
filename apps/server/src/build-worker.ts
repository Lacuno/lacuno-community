import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from '@lacuno/compiler/build'

const [directory, siteUrl, imageCache] = process.argv.slice(2)
if (!directory || !siteUrl || !imageCache)
  throw new Error('Expected snapshot directory, published URL and image cache')
try {
  const result = await build(directory, { siteUrl, quiet: true, imageCache })
  await writeFile(
    path.join(directory, 'result.json'),
    JSON.stringify({ warnings: result.warnings }),
  )
} catch (error) {
  await writeFile(
    path.join(directory, 'result.json'),
    JSON.stringify({ error: error instanceof Error ? error.message : 'Build failed' }),
  )
  process.exitCode = 1
}

import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from '@lacuno/compiler/build'

// Astro optimizes as many images at once as it sees cores, the host's in a container with one CPU,
// and every image in flight costs its decoded pixels. One at a time keeps a site of photos in memory.
os.availableParallelism = () => 1

const [directory, siteUrl, imageCache, maxImageWidth] = process.argv.slice(2)
if (!directory || !siteUrl || !imageCache)
  throw new Error('Expected snapshot directory, published URL and image cache')
try {
  const result = await build(directory, {
    siteUrl,
    quiet: true,
    imageCache,
    ...(maxImageWidth ? { maxImageWidth: Number(maxImageWidth) } : {}),
  })
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

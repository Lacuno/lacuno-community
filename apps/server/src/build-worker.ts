import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from '@miralo/compiler/build'

const [directory, siteUrl] = process.argv.slice(2)
if (!directory || !siteUrl) throw new Error('Expected snapshot directory and published URL')
try {
  const result = await build(directory, { siteUrl, quiet: true })
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

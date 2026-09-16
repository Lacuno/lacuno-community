import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFixtureSite } from '@freeflow/compiler/build'

/**
 * Exercises the actual tsdown bundle at `apps/cli/dist/main.js`, not the TypeScript source: unit
 * tests run `apps/cli/src` directly and would not catch a bundling mistake (a missing external,
 * a broken relative import after inlining) that only breaks the built binary.
 */
async function main(): Promise<number> {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const cli = path.join(repoRoot, 'apps/cli/dist/main.js')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-smoke-'))
  try {
    await writeFixtureSite(dir)
    const result = spawnSync('node', [cli, 'build', dir, '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      console.error(result.stdout)
      console.error(result.stderr)
      return 1
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(result.stdout)
    } catch (e) {
      console.error(result.stdout)
      console.error(`smoke: could not parse CLI output as JSON: ${(e as Error).message}`)
      return 1
    }
    const pages = (parsed as { pages?: unknown }).pages
    if (pages !== 4) {
      console.error(result.stdout)
      return 1
    }
    console.log('smoke ok: 4 pages')
    return 0
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

process.exitCode = await main()

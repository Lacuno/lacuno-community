import { parseArgs } from 'node:util'
import { BuildError } from '@freeflow/compiler'
import { build } from '@freeflow/compiler/build'

export const BUILD_USAGE = 'Usage: freeflow build [dir] [--out <dir>] [--site-url <url>] [--json]'

export type Io = { log: (s: string) => void; error: (s: string) => void }

export type BuildArgs = { dir: string; out?: string; siteUrl?: string; json: boolean }

const OPTIONS = {
  out: { type: 'string' },
  'site-url': { type: 'string' },
  json: { type: 'boolean', default: false },
} as const

function parseOrUsage(args: string[]) {
  try {
    return parseArgs({ args, options: OPTIONS, allowPositionals: true })
  } catch (e) {
    throw new Error(`${(e as Error).message}\n${BUILD_USAGE}`)
  }
}

export function parseBuildArgs(args: string[]): BuildArgs {
  const parsed = parseOrUsage(args)
  if (parsed.positionals.length > 1) throw new Error(`too many arguments\n${BUILD_USAGE}`)
  const result: BuildArgs = { dir: parsed.positionals[0] ?? '.', json: parsed.values.json ?? false }
  if (parsed.values.out !== undefined) result.out = parsed.values.out
  if (parsed.values['site-url'] !== undefined) result.siteUrl = parsed.values['site-url']
  return result
}

function describeError(e: unknown): { kind: string; message: string; detail?: string } {
  if (e instanceof BuildError) {
    return e.detail
      ? { kind: e.kind, message: e.message, detail: e.detail }
      : { kind: e.kind, message: e.message }
  }
  return { kind: 'unexpected', message: e instanceof Error ? (e.stack ?? e.message) : String(e) }
}

export async function runBuild(args: string[], io: Io): Promise<number> {
  let parsed: BuildArgs
  try {
    parsed = parseBuildArgs(args)
  } catch (e) {
    io.error((e as Error).message)
    return 1
  }
  try {
    const result = await build(parsed.dir, {
      ...(parsed.out !== undefined ? { outDir: parsed.out } : {}),
      ...(parsed.siteUrl !== undefined ? { siteUrl: parsed.siteUrl } : {}),
      quiet: parsed.json,
    })
    if (parsed.json) {
      io.log(JSON.stringify(result))
      return 0
    }
    for (const w of result.warnings) io.error(`warning: ${w.node}: ${w.message}`)
    io.log(`Built ${result.pages} pages to ${result.outDir} in ${result.durationMs} ms`)
    return 0
  } catch (e) {
    const err = describeError(e)
    if (parsed.json) {
      io.log(JSON.stringify({ error: err }))
    } else {
      io.error(`${err.kind} error: ${err.message}`)
      if (err.detail) io.error(err.detail)
    }
    return 1
  }
}

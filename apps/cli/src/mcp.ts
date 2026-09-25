import { parseArgs } from 'node:util'
import { describeError, serveStdio } from '@lacuno/mcp'
import type { Io } from './build.js'

export const MCP_USAGE = 'Usage: lacuno mcp [dir]'

export function parseMcpArgs(args: string[]): { dir: string } {
  const parsed = parseArgs({ args, options: {}, allowPositionals: true })
  if (parsed.positionals.length > 1) throw new Error(`too many arguments\n${MCP_USAGE}`)
  return { dir: parsed.positionals[0] ?? '.' }
}

export async function runMcp(args: string[], io: Io): Promise<number> {
  let dir: string
  try {
    dir = parseMcpArgs(args).dir
  } catch (e) {
    io.error((e as Error).message)
    return 1
  }
  try {
    await serveStdio(dir)
    return 0
  } catch (e) {
    const d = describeError(e)
    io.error(`${d.kind} error: ${d.message}`)
    return 1
  }
}

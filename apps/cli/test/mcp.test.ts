import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFolder } from '@miralo/document/folder'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, describe, expect, it } from 'vitest'
import { parseMcpArgs } from '../src/mcp.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('miralo mcp', () => {
  it('exits cleanly when its client closes stdin', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-mcp-eof-'))
    dirs.push(dir)
    await createFolder(dir, 'EOF')
    const child = spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', 'mcp', dir], {
      cwd: path.resolve(import.meta.dirname, '../../..'),
      stdio: 'pipe',
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const exited = once(child, 'exit')
    child.stdin.end()
    const [code] = await exited
    expect(stderr).toBe('')
    expect(code).toBe(0)
  })
  it('parses the directory argument', () => {
    expect(parseMcpArgs([])).toEqual({ dir: '.' })
    expect(parseMcpArgs(['site'])).toEqual({ dir: 'site' })
    expect(() => parseMcpArgs(['a', 'b'])).toThrow(/Usage/)
  })

  it('serves MCP over stdio', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-mcp-cli-'))
    dirs.push(dir)
    await createFolder(dir, 'Site')
    const root = path.resolve(import.meta.dirname, '../../..')
    const transport = new StdioClientTransport({
      command: 'pnpm',
      args: ['exec', 'tsx', 'apps/cli/src/main.ts', 'mcp', dir],
      cwd: root,
    })
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(transport)
    const tools = (await client.listTools()).tools.map((t) => t.name)
    expect(tools).toContain('document.apply')
    const read = await client.callTool({ name: 'document.read', arguments: {} })
    expect(JSON.parse((read.content as { text: string }[])[0]!.text).site.name).toBe('Site')
    await client.close()
  })
})

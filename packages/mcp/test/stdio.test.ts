import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFolder } from '@miralo/document/folder'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { afterEach, describe, expect, it } from 'vitest'
import { serveStdio } from '../src/stdio.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

/** A `Transport` that does nothing on the wire; tests trigger its callbacks directly. */
function fakeTransport(): Transport {
  return {
    start: async () => {},
    send: async () => {},
    close: async () => {},
  }
}

async function waitUntil(fn: () => boolean): Promise<void> {
  while (!fn()) await new Promise((resolve) => setTimeout(resolve, 5))
}

async function siteDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-mcp-stdio-'))
  dirs.push(dir)
  await createFolder(dir, 'Site')
  return dir
}

describe('serveStdio', () => {
  it('resolves when the transport closes, still invoking a previously installed onclose', async () => {
    const transport = fakeTransport()
    let prevCloseCalled = false
    const originalOnClose = () => {
      prevCloseCalled = true
    }
    transport.onclose = originalOnClose
    const running = serveStdio(await siteDir(), transport)
    await waitUntil(() => transport.onclose !== originalOnClose)
    transport.onclose?.()
    await expect(running).resolves.toBeUndefined()
    expect(prevCloseCalled).toBe(true)
  })

  it('rejects when the transport errors', async () => {
    const transport = fakeTransport()
    const running = serveStdio(await siteDir(), transport)
    await waitUntil(() => transport.onerror !== undefined)
    const boom = new Error('boom')
    transport.onerror?.(boom)
    await expect(running).rejects.toThrow('boom')
  })
})

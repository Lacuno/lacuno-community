import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from '../src/app.js'
import { type SiteEvent, siteEvents } from '../src/events.js'
import type { OAuth } from '../src/oauth.js'

const origin = 'http://localhost:3000'
const token = 'Bearer test-token'
let dataDir = ''
let server: Awaited<ReturnType<typeof createServer>>
let cookie = ''
let siteId = ''
let revoked = false
let touched: string[] = []

/** One approved connection, "conn-1", valid for any site until revoked. */
const oauth: OAuth = {
  verify: async (authorization, site) =>
    authorization === token && !revoked
      ? { userId: 'u', siteId: site, clientId: 'conn-1', app: 'Test App' }
      : null,
  connections: () =>
    revoked ? [] : [{ id: 'conn-1', app: 'Test App', approvedAt: 1, lastActiveAt: null }],
  revoke: async (_, id) => {
    if (id !== 'conn-1' || revoked) return false
    revoked = true
    return true
  },
  touch: (id) => {
    touched.push(id)
  },
}

const request = (route: string, init: RequestInit = {}) =>
  server.app.request(origin + route, {
    ...init,
    headers: { cookie, origin, 'content-type': 'application/json', ...init.headers },
  })

async function connect() {
  const client = new Client({ name: 'Test Agent', version: '1.2.3' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp/${siteId}`), {
      requestInit: { headers: { authorization: token } },
      fetch: async (url, init) => server.app.request(url, init),
    }) as Transport,
  )
  return client
}

const json = <T>(result: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse((result.content as { text: string }[])[0]!.text) as T

beforeEach(async () => {
  revoked = false
  touched = []
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'miralo-mcp-endpoint-'))
  server = await createServer({
    dataDir,
    templateDir: fileURLToPath(new URL('../../../templates/miralo', import.meta.url)),
    baseURL: origin,
    publishBaseURL: 'http://localhost:4000',
    secret: 'test-only-secret-6ea8114c2a7b4e68ba29c69b',
    allowSignup: true,
    oauth,
  })
  const signup = await request('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Owner',
      email: 'owner@example.test',
      password: 'pw-2026-abcdef',
    }),
  })
  cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const site = await request('/api/sites', {
    method: 'POST',
    body: JSON.stringify({ name: 'Acme' }),
  })
  siteId = ((await site.json()) as { id: string }).id
})

afterEach(async () => {
  server.close()
  await rm(dataDir, { recursive: true, force: true })
})

describe('the remote MCP endpoint', () => {
  it('refuses a request without a valid token and points at the resource metadata', async () => {
    const response = await server.app.request(`${origin}/mcp/${siteId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp/${siteId}"`,
    )
    const config = (await (await request('/api/config')).json()) as Record<string, unknown>
    expect(config).toMatchObject({ origin, local: true })
  })

  it('reads and applies the document the editor reads, and reports each batch', async () => {
    const client = await connect()
    const tools = (await client.listTools()).tools.map((tool) => tool.name)
    expect(tools).toContain('site.publish')
    expect(tools).not.toContain('site.build')
    const { revision } = json<{ revision: number }>(
      await client.callTool({ name: 'document.read', arguments: {} }),
    )
    const events: SiteEvent[] = []
    const unsubscribe = siteEvents.subscribe(siteId, (event) => events.push(event))
    const operations = [{ type: 'class.create', id: 'c-agent', name: 'agent' }]
    const applied = await client.callTool({
      name: 'document.apply',
      arguments: { expectedRevision: revision, operations },
    })
    unsubscribe()
    expect(applied.isError).not.toBe(true)
    const editor = (await (await request(`/api/sites/${siteId}/document`)).json()) as {
      document: { classes: Record<string, unknown> }
      revision: number
    }
    expect(editor.revision).toBe(revision + 1)
    expect(editor.document.classes['c-agent']).toBeDefined()
    expect(events).toEqual([
      expect.objectContaining({
        revision: revision + 1,
        actor: { kind: 'agent', app: 'Test Agent' },
        summary: '1 operation: class.create',
      }),
    ])
    expect(touched).toContain('conn-1')

    const stale = await client.callTool({
      name: 'document.apply',
      arguments: { expectedRevision: revision, operations: [{ type: 'class.create', name: 'x' }] },
    })
    expect(json(stale)).toMatchObject({ kind: 'stale', current: revision + 1 })

    // The editor saves; the session sees it on its next call.
    await request(`/api/sites/${siteId}/document/apply`, {
      method: 'POST',
      body: JSON.stringify({
        expectedRevision: revision + 1,
        operations: [{ type: 'class.create', id: 'c-editor', name: 'editor' }],
      }),
    })
    const read = json<{ revision: number }>(
      await client.callTool({ name: 'document.read', arguments: {} }),
    )
    expect(read.revision).toBe(revision + 2)

    const asset = json<{ hash: string; size: number }>(
      await client.callTool({
        name: 'asset.import',
        arguments: { name: 'note.txt', mime: 'text/plain', data: 'aGVsbG8=' },
      }),
    )
    expect(asset.size).toBe(5)
    expect(existsSync(path.join(dataDir, 'sites', siteId, 'assets', asset.hash))).toBe(true)
    await client.close()
  })

  it("screenshots a page from the site's stored assets", async () => {
    const client = await connect()
    const result = await client.callTool({
      name: 'page.screenshot',
      arguments: { page: '/', width: 600, height: 400 },
    })
    expect(result.isError).not.toBe(true)
    const [image, size] = result.content as { type: string; mimeType?: string; text?: string }[]
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(size?.text).toBe('600×400')
    await client.close()
  })

  it('lists the connection as active and revoking it closes the session', async () => {
    const client = await connect()
    const list = async () => (await request(`/api/sites/${siteId}/connections`)).json()
    expect(await list()).toEqual([
      { id: 'conn-1', app: 'Test App', approvedAt: 1, lastActiveAt: null, active: true },
    ])
    const sessionId = (client.transport as StreamableHTTPClientTransport).sessionId!
    const remove = (id: string) =>
      request(`/api/sites/${siteId}/connections/${id}`, { method: 'DELETE' })
    expect((await remove('conn-1')).status).toBe(204)
    expect(await list()).toEqual([])
    expect((await remove('conn-1')).status).toBe(404)
    revoked = false // Even with a valid token again, the closed session is gone.
    const reused = await server.app.request(`${origin}/mcp/${siteId}`, {
      method: 'POST',
      headers: {
        authorization: token,
        'mcp-session-id': sessionId,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
    })
    expect(reused.status).toBe(404)
  })

  it('publishes to testing and returns the testing address', { timeout: 150_000 }, async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'site.publish', arguments: { name: 'Agent' } })
    expect(json(result)).toEqual({ url: expect.stringContaining('localhost:4000') })
    const history = (await (await request(`/api/sites/${siteId}/releases`)).json()) as {
      testingUrl: string
      testingId: string
      releases: { id: string; name: string; target: string }[]
    }
    expect(json(result)).toEqual({ url: history.testingUrl })
    expect(history.releases[0]).toMatchObject({
      id: history.testingId,
      name: 'Agent',
      target: 'testing',
    })
    await client.close()
  })
})

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { chromium, type Page } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import type { OAuth } from '../src/oauth.js'
import { drag, launch } from './harness.js'

// Spike: the editor inside an MCP App view on another origin. A fake host at HOST serves the view
// under a CSP like claude.ai's (nested frames only 'self', blob: and data:), the runtime allows
// that origin, and the editor talks to it with a bearer from the editor.session tool. A loopback
// name: a secure context like a real https view (crypto.randomUUID needs one) with no mixed
// content against the http test runtime.
const HOST = 'http://host.localhost'
const CONNECTOR = 'https://example.test/mcp/site'
const token = 'Bearer test-token'
let userId = ''
const oauth: OAuth = {
  verify: async (authorization, site) =>
    authorization === token
      ? { userId, siteId: site, clientId: 'app-1', connectionId: 'conn-1', app: 'Claude' }
      : null,
  connections: () => [],
  revoke: async () => {},
  touch: () => {},
}

/**
 * A page on HOST. A page Playwright fulfils has no address, so Chromium's Local Network Access
 * check takes it for public and denies its requests to 127.0.0.1; only the test setup faces
 * that (a runtime is public), so the check is off in this browser.
 */
async function hostPage() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests',
    ],
  })
  onTestFinished(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  context.setDefaultTimeout(8000)
  return context.newPage()
}

/** A runtime that allows HOST, with an owner, a site and an MCP client as the owner's AI app. */
async function runtime() {
  const launched = await launch({ width: 1400, height: 1000 }, true, {
    oauth,
    allowedOrigins: [HOST],
    connectorUrl: CONNECTOR,
  })
  const { server, origin } = launched
  const request = (route: string, init: RequestInit & { cookie?: string } = {}) =>
    server.app.request(origin + route, {
      ...init,
      headers: { origin, 'content-type': 'application/json', ...init.headers },
    })
  const signup = await request('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Owner',
      email: 'owner@example.test',
      password: 'pw-2026-abcdef',
    }),
  })
  userId = ((await signup.json()) as { user: { id: string } }).user.id
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const asOwner = (route: string) => request(route, { headers: { cookie } })
  const site = await request('/api/sites', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ name: 'Embedded site' }),
  })
  const siteId = ((await site.json()) as { id: string }).id
  const client = new Client({ name: 'Claude', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp/${siteId}`), {
      requestInit: { headers: { authorization: token } },
      fetch: async (url, init) => server.app.request(url, init),
    }) as Transport,
  )
  const readDocument = async () =>
    (await (await asOwner(`/api/sites/${siteId}/document`)).json()) as {
      revision: number
      document: { nodes: Record<string, { text?: { value?: string } } | undefined> }
    }
  return { ...launched, request, asOwner, siteId, client, readDocument }
}

type Session = { token: string; origin: string; site: string; expiresAt: string }
const session = async (client: Client) =>
  JSON.parse(
    (
      (await client.callTool({ name: 'editor.session', arguments: {} })).content as {
        text: string
      }[]
    )[0]!.text,
  ) as Session

/** Waits for a save that started after the last call to land and the status line to settle. */
function saves(page: Page, within: Page | ReturnType<Page['frameLocator']> = page) {
  let writes = 0
  let seen = 0
  page.on('response', (response) => {
    if (response.url().includes('/document/apply')) writes++
  })
  return async () => {
    await expect.poll(() => writes).toBeGreaterThan(seen)
    await expect.poll(() => within.locator('.save-state').textContent()).toBe('All changes saved')
    seen = writes
  }
}

it('A+B: with a token and no cookie, the editor loads as a blob canvas and edits as the user', async () => {
  const { page, origin, siteId, client, readDocument } = await runtime()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const { token: bearer, origin: runtimeOrigin, expiresAt } = await session(client)
  expect(runtimeOrigin).toBe(origin)
  expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now())
  const streams: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/events')) streams.push(request.url())
  })
  const saved = saves(page)
  // No sign-in happened in this browser: the fragment alone opens the site.
  await page.goto(`${origin}/?site=${siteId}#token=${bearer}&origin=${origin}`)
  const canvas = page.frameLocator('iframe[title="Site canvas"]')
  await canvas.locator('#lacuno-selection-overlay').waitFor({ state: 'attached' })
  expect(await canvas.locator('html').evaluate(() => document.URL)).toMatch(/^blob:/)
  // No base tag (claude.ai keeps base-uri 'self'): the runtime wrote absolute asset addresses.
  expect(await canvas.locator('img[src]').first().getAttribute('src')).toMatch(
    new RegExp(`^${origin}/api/sites/`),
  )
  await expect
    .poll(() =>
      canvas
        .locator('img[src]')
        .first()
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  // EventSource takes no header: the stream carries the token in its query.
  await expect.poll(() => streams.length).toBeGreaterThan(0)
  expect(streams[0]).toBe(`${origin}/api/sites/${siteId}/events?token=${bearer}`)
  // Nothing of the host chrome: no Publish, Connect or back.
  expect(await page.getByRole('button', { name: 'Publish' }).count()).toBe(0)
  expect(await page.locator('.connect-trigger').count()).toBe(0)
  expect(await page.getByRole('button', { name: 'Back to sites' }).count()).toBe(0)

  // Select: the overlay's shadow root draws the marching outline and the handles.
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.click()
  const outline = canvas.locator('.selection-dashes')
  await expect.poll(async () => Number(await outline.getAttribute('width'))).toBeGreaterThan(0)
  expect(await canvas.locator('.handle.size.right').count()).toBe(1)
  // Hover: the canvas's own :hover outline on an unselected node.
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.hover()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).outlineStyle))
    .toBe('solid')
  // The drop indicator is installed by the drag surface binding.
  expect(await canvas.locator('#lacuno-drop-indicator').count()).toBe(1)

  // A size handle drag, saved through the bearer as the owner.
  const width = () => cta.evaluate((element) => element.getBoundingClientRect().width)
  const before = await width()
  const { revision } = await readDocument()
  await drag(page, '.handle.size.right', { dx: 60 })
  await saved()
  await expect.poll(width).toBeGreaterThan(before + 30)
  expect((await readDocument()).revision).toBe(revision + 1)

  // Inline text editing inside the blob document.
  await heading.dblclick()
  const editable = canvas.getByLabel('Canvas text editor')
  await editable.waitFor()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Edited inside a blob')
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await saved()
  await expect.poll(() => heading.textContent()).toBe('Edited inside a blob')

  // Delete with the keyboard.
  await cta.click()
  await page.keyboard.press('Delete')
  await saved()
  await expect.poll(() => cta.count()).toBe(0)
  expect((await readDocument()).document.nodes['n-home-cta']).toBeUndefined()
  expect(errors).toEqual([])
}, 60_000)

it('B: another origin reaches the API with the bearer and CORS, and is refused without', async () => {
  const { origin, siteId, client, request } = await runtime()
  const { token: bearer } = await session(client)
  // Server side: the preflight and the answer carry the allowed origin.
  const preflight = await request('/api/config', {
    method: 'OPTIONS',
    headers: { origin: HOST, 'access-control-request-method': 'GET' },
  })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('access-control-allow-origin')).toBe(HOST)
  expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization')
  const config = await request('/api/config', {
    headers: { origin: HOST, authorization: `Bearer ${bearer}` },
  })
  expect(config.status).toBe(200)
  expect(config.headers.get('access-control-allow-origin')).toBe(HOST)
  expect((await request('/api/config', { headers: { origin: HOST } })).status).toBe(401)
  expect(
    (await request('/api/config', { headers: { origin: 'https://other.test' } })).headers.get(
      'access-control-allow-origin',
    ),
  ).toBeNull()
  // The bearer is good for its site only, and the stream takes it from the query.
  expect(
    (
      await request('/api/sites/not-this-site/document', {
        headers: { origin: HOST, authorization: `Bearer ${bearer}` },
      })
    ).status,
  ).toBe(404)
  const stream = await request(`/api/sites/${siteId}/events?token=${bearer}`, {
    headers: { origin: HOST },
  })
  expect(stream.status).toBe(200)
  expect(stream.headers.get('content-type')).toContain('text/event-stream')
  await stream.body?.cancel()

  // Browser side, from a page on HOST.
  const page = await hostPage()
  await page.route(`${HOST}/**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>host</title>' }),
  )
  await page.goto(HOST)
  const call = (headers: Record<string, string>) =>
    page.evaluate(
      ([url, headers]) =>
        fetch(url, { headers, credentials: 'omit' }).then(
          (response) => ({ status: response.status, ok: response.ok }),
          (error: Error) => ({ error: error.message }),
        ),
      [`${origin}/api/config`, headers] as const,
    )
  expect(await call({ authorization: `Bearer ${bearer}` })).toEqual({ status: 200, ok: true })
  expect(await call({})).toEqual({ status: 401, ok: false })
  // A write from HOST with the bearer passes the same-origin check that a cookie request faces.
  const { revision } = JSON.parse(
    await page.evaluate(
      ([url, bearer]) =>
        fetch(url, { headers: { authorization: `Bearer ${bearer}` } }).then((r) => r.text()),
      [`${origin}/api/sites/${siteId}/document`, bearer] as const,
    ),
  ) as { revision: number }
  const applied = await page.evaluate(
    ([url, bearer, revision]) =>
      fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: revision,
          operations: [{ type: 'class.create', id: 'c-embedded', name: 'embedded' }],
        }),
      }).then((r) => r.status),
    [`${origin}/api/sites/${siteId}/document/apply`, bearer, revision] as const,
  )
  expect(applied).toBe(200)
}, 30_000)

/** The host's CSP as claude.ai builds it from the view's `_meta.ui.csp`, for our runtime. */
const csp = (origin: string) =>
  [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${origin}`,
    `style-src 'self' 'unsafe-inline' ${origin}`,
    `img-src 'self' data: ${origin}`,
    `font-src ${origin}`,
    `media-src 'self' data: ${origin}`,
    `connect-src ${origin}`,
    "frame-src 'self' blob: data:",
    "object-src 'none'",
  ].join('; ')

it('what the host CSP allows: nested srcdoc and blob frames, and blob in an opaque sandbox', async () => {
  const { origin } = await runtime()
  const page = await hostPage()
  await page.route(`${HOST}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': csp(origin) },
      body: `<!doctype html><title>host</title><iframe id="opaque" sandbox="allow-scripts" srcdoc="<script>
        const url = URL.createObjectURL(new Blob(['<p>blob</p>'], { type: 'text/html' }))
        const frame = document.createElement('iframe')
        frame.src = url
        frame.onload = () => { let text; try { text = frame.contentDocument.body.textContent } catch (e) { text = 'unreachable: ' + e.name }; parent.postMessage({ opaque: text }, '*') }
        document.documentElement.append(frame)
      </script>"></iframe>
      <script>addEventListener('message', (e) => { if (e.data.opaque) window.opaqueResult = e.data.opaque })</script>`,
    }),
  )
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text())
  })
  await page.goto(HOST)
  const nested = (kind: 'srcdoc' | 'blob') =>
    page.evaluate(
      (kind) =>
        new Promise<string>((resolve) => {
          const frame = document.createElement('iframe')
          const html = `<p>${kind}</p>`
          if (kind === 'srcdoc') frame.srcdoc = html
          else frame.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
          frame.onload = () => resolve(frame.contentDocument?.body.textContent ?? 'no document')
          document.body.append(frame)
          setTimeout(() => resolve('never loaded'), 3000)
        }),
      kind,
    )
  expect(await nested('blob')).toBe('blob')
  expect(await nested('srcdoc')).toBe('srcdoc')
  // Without allow-same-origin the view's origin is opaque, and a blob frame it makes gets an
  // origin of its own: the editor could not reach into its canvas. The view needs a real origin.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { opaqueResult?: string }).opaqueResult))
    .toBe('unreachable: TypeError')
  expect(violations).toEqual([])
}, 30_000)

it('C+D: the editor view bootstraps the editor inside a fake host and talks to the chat', async () => {
  const { origin, client, readDocument } = await runtime()
  const page = await hostPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const tools = (await client.listTools()).tools
  const open = tools.find((tool) => tool.name === 'editor.open')
  expect(open?._meta).toEqual({ ui: { resourceUri: 'ui://lacuno/editor-view' } })
  const opened = await client.callTool({ name: 'editor.open', arguments: { page: '/' } })
  expect((opened.content as { text: string }[])[0]?.text).toBe('Opened "Home" (/) in the editor.')
  const resource = (await client.listResources()).resources.find(
    (item) => item.uri === 'ui://lacuno/editor-view',
  )
  const ui = {
    csp: { connectDomains: [origin], resourceDomains: [origin] },
    domain: expect.stringMatching(/^[0-9a-f]{32}\.claudemcpcontent\.com$/),
  }
  expect(resource?._meta).toEqual({ ui })
  const { contents } = await client.readResource({ uri: 'ui://lacuno/editor-view' })
  expect(contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app', _meta: { ui } })
  const view = (contents[0] as { text: string }).text

  // The host: answers initialize, hands over the tool's input and result, proxies tools/call to
  // the real MCP session, and records what the view sends.
  await page.exposeFunction('callTool', (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args }),
  )
  await page.route(`${HOST}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': csp(origin) },
      body: `<!doctype html><body style="margin:0">
<iframe id="view" sandbox="allow-scripts allow-same-origin allow-forms" style="width:1400px;height:950px;border:0"></iframe>
<script>
  const messages = (window.messages = [])
  const send = (message) => document.getElementById('view').contentWindow.postMessage({ jsonrpc: '2.0', ...message }, '*')
  addEventListener('message', async ({ data }) => {
    if (data?.jsonrpc !== '2.0') return
    messages.push(data)
    if (data.method === 'ui/initialize')
      send({ id: data.id, result: { protocolVersion: '2025-06-18', hostCapabilities: {}, hostContext: { theme: 'light', displayMode: 'inline' } } })
    else if (data.method === 'ui/notifications/initialized') {
      send({ method: 'ui/notifications/tool-input', params: { arguments: { page: '/' } } })
      send({ method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'Opened "Home" (/) in the editor.' }] } })
    } else if (data.method === 'tools/call') send({ id: data.id, result: await window.callTool(data.params.name, data.params.arguments) })
    else if (data.method === 'ui/request-display-mode') send({ id: data.id, result: { mode: data.params.mode } })
    else if (data.id !== undefined) send({ id: data.id, result: {} })
  })
</script>`,
    }),
  )
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text())
  })
  await page.goto(HOST)
  await page.evaluate((html) => {
    document.querySelector<HTMLIFrameElement>('#view')!.srcdoc = html
  }, view)
  type Message = { method?: string; params?: { mode?: string; content?: { text: string } } }
  const sent = (method: string) =>
    page.evaluate(
      (method) =>
        (window as unknown as { messages: Message[] }).messages.filter((m) => m.method === method),
      method,
    )

  const frame = page.frameLocator('#view')
  await frame.locator('.editor-header .site-name').waitFor()
  await expect.poll(() => frame.locator('.site-name').textContent()).toContain('Embedded site')
  const canvas = frame.frameLocator('iframe[title="Site canvas"]')
  await canvas.locator('#lacuno-selection-overlay').waitFor({ state: 'attached' })
  expect(await canvas.locator('html').evaluate(() => document.URL)).toMatch(/^blob:/)
  await expect
    .poll(() =>
      canvas
        .locator('img[src]')
        .first()
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  // Embedded mode: fullscreen asked once, no publish or connect chrome.
  await expect.poll(() => sent('ui/request-display-mode')).toHaveLength(1)
  expect((await sent('ui/request-display-mode'))[0]?.params).toEqual({ mode: 'fullscreen' })
  expect(await frame.getByRole('button', { name: 'Publish' }).count()).toBe(0)
  expect(await frame.locator('.connect-trigger').count()).toBe(0)
  expect(await frame.locator('.layers, .layers-panel, aside').count()).toBeGreaterThan(0)

  // Select, then Ask AI: the brief goes to the chat as the person's message, no dialog.
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.click()
  await expect
    .poll(async () => Number(await canvas.locator('.selection-dashes').getAttribute('width')))
    .toBeGreaterThan(0)
  await canvas.getByRole('button', { name: 'Ask AI' }).click()
  await expect.poll(() => sent('ui/message')).toHaveLength(1)
  expect((await sent('ui/message'))[0]?.params?.content?.text).toMatch(
    /^In Lacuno, on the site "Embedded site", open the page "Home" \(\/\) and look at the .+ \(element n-home-title\)\. Fix what looks off/,
  )
  expect(await frame.locator('.ask-dialog').count()).toBe(0)

  // A text edit from the inspector, saved cross-origin with the bearer, lands in the document.
  const saved = saves(page, frame)
  await frame.getByRole('tab', { name: 'Content', exact: true }).click()
  await frame.getByLabel('Text', { exact: true }).fill('Edited from the chat')
  await saved()
  await expect.poll(() => heading.textContent()).toBe('Edited from the chat')
  expect(JSON.stringify((await readDocument()).document.nodes['n-home-title'])).toContain(
    'Edited from the chat',
  )
  expect(violations).toEqual([])
  expect(errors).toEqual([])
}, 90_000)

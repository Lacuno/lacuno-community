import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../src/app.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const issuer = 'http://cloud.localhost:4000'
const origin = 'http://runtime.editor.localhost:4000'
const secret = 'origin-test-gateway-key-of-32-characters'
const owner = { sub: 'cloud-user-1', name: 'Gateway owner', email: 'owner@example.test' }
const system = {
  sub: 'lacuno-cloud',
  name: 'Lacuno Cloud',
  email: 'system@lacuno.invalid',
  system: true,
}
type History = {
  publishedId: string | null
  url: string
  releases: { id: string; revision: number; version: number; status: string }[]
}

describe('site origin', () => {
  let dir = ''
  let server: Awaited<ReturnType<typeof createServer>>
  let site = ''
  const call = async (target: string, data?: unknown, as: object = owner) => {
    const method = data === undefined ? 'GET' : 'POST'
    const body = data === undefined ? '' : JSON.stringify(data)
    const now = Math.floor(Date.now() / 1000)
    const assertion = await new SignJWT({
      ...as,
      jti: randomUUID(),
      iat: now,
      exp: now + 30,
      method,
      target,
      bodyHash: createHash('sha256').update(body).digest('hex'),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setAudience(origin)
      .sign(new TextEncoder().encode(secret))
    return server.app.request(origin + target, {
      method,
      headers: { 'content-type': 'application/json', 'x-lacuno-assertion': assertion },
      ...(body ? { body } : {}),
    })
  }
  const json = async (target: string, data?: unknown) => (await call(target, data)).json()
  const history = () => json(`/api/sites/${site}/releases`) as Promise<History>
  const setOrigin = (value: string | null, siteId = site) =>
    call('/api/gateway/site-origin', { siteId, origin: value }, system)
  const live = async (file: string) => {
    const { publishedId } = await history()
    return readFile(path.join(dir, 'builds', site, publishedId!, 'dist', file), 'utf8')
  }
  const settled = async (version: number) => {
    await expect
      .poll(
        async () => {
          const { publishedId, releases } = await history()
          return releases.find((release) => release.id === publishedId)?.version
        },
        { timeout: 60_000 },
      )
      .toBe(version)
    return history()
  }

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-origin-'))
    server = await createServer({
      dataDir: dir,
      baseURL: origin,
      publishBaseURL: 'http://sites.localhost',
      secret: 'origin-test-auth-secret-at-least-32-chars',
      templateDir: path.join(root, 'templates/lacuno'),
      gateway: { issuer, secret },
    })
    site = (await json('/api/sites', { name: 'Origin' })).id
  })
  afterAll(async () => {
    server.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('takes an origin from the gateway only, for a site it has', async () => {
    expect((await call('/api/gateway/site-origin', { siteId: site, origin: null })).status).toBe(
      403,
    )
    for (const value of ['https://example.com/', 'https://example.com/path', 'example.com'])
      expect((await setOrigin(value)).status).toBe(400)
    expect((await setOrigin('https://example.com', randomUUID())).status).toBe(404)
    // Cloud's assertion sets origins and does nothing else.
    expect((await call('/api/sites', undefined, system)).status).toBe(401)
  })

  it('links a site to its origin and builds the live release again, not the draft', async () => {
    const label = `http://${site}.sites.localhost`
    const { revision } = await json(`/api/sites/${site}/document`)
    await json(`/api/sites/${site}/releases`, { expectedRevision: revision, expectedId: null })
    const first = await settled(1)
    expect(first.url).toBe(label)
    expect(await live('index.html')).toContain(`<link rel="canonical" href="${label}/">`)

    // An unpublished edit stays unpublished.
    const edited = await call(`/api/sites/${site}/document/apply`, {
      expectedRevision: revision,
      operations: [
        {
          type: 'node.update',
          id: 'n-home-title',
          text: { type: 'static', value: 'An unpublished draft' },
        },
      ],
    })
    expect(edited.status).toBe(200)

    expect(await (await setOrigin('https://www.example.com')).json()).toEqual({
      origin: 'https://www.example.com',
    })
    const second = await settled(2)
    expect(second.url).toBe('https://www.example.com')
    expect(second.releases[0]).toMatchObject({ version: 2, revision })
    const home = await live('index.html')
    expect(home).toContain('<link rel="canonical" href="https://www.example.com/">')
    expect(home).toContain('<meta property="og:url" content="https://www.example.com/">')
    expect(home).not.toContain(label)
    expect(home).not.toContain('An unpublished draft')
    expect(await live('robots.txt')).toContain('Sitemap: https://www.example.com/sitemap-index.xml')
    expect(await live('sitemap-0.xml')).toContain('<loc>https://www.example.com/</loc>')

    // The same origin again changes nothing; none goes back to the published address.
    await setOrigin('https://www.example.com')
    expect((await history()).releases).toHaveLength(2)
    await setOrigin(null)
    expect((await settled(3)).url).toBe(label)
    expect(await live('index.html')).toContain(`<link rel="canonical" href="${label}/">`)
  }, 180_000)
})

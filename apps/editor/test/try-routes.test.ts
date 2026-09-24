import { readFileSync } from 'node:fs'
import { DocumentStore, MemoryPersistence } from '@freeflow/document'
import { expect, it } from 'vitest'
import { handle } from '../src/try/routes.js'

const template = JSON.parse(
  readFileSync(new URL('../../../templates/freeflow/freeflow.json', import.meta.url), 'utf8'),
)
const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

class TestPersistence extends MemoryPersistence {
  async getAsset(hash: string) {
    return this.assets.get(hash) as Uint8Array<ArrayBuffer> | undefined
  }
}

function site() {
  const persistence = new TestPersistence(template)
  const store = DocumentStore.withPersistence(persistence)
  return (path: string, body?: unknown) =>
    handle(
      new Request(`https://try.example${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      store,
      persistence,
    )
}

it('answers config, session and the one site, and refuses a second', async () => {
  const request = site()
  expect(await (await request('/api/config'))!.json()).toEqual({
    allowSignup: false,
    setupRequired: false,
    origin: 'https://try.example',
    local: false,
    try: true,
  })
  expect(await (await request('/api/auth/get-session'))!.json()).toMatchObject({
    user: { name: 'Visitor' },
  })
  expect(await (await request('/api/sites'))!.json()).toEqual({
    sites: [{ id: 'try', name: 'Freeflow', revision: template.revision }],
  })
  const create = (await request('/api/sites', { name: 'Another' }))!
  expect(create.status).toBe(403)
  expect(await create.json()).toEqual({ error: 'Sign up to create more sites.' })
  expect((await request('/api/sites/other/document'))!.status).toBe(404)
})

it('applies a batch, previews it and refuses a stale one', async () => {
  const request = site()
  const text = { type: 'static', value: 'Edited in the browser' }
  const apply = (expectedRevision: number) =>
    request('/api/sites/try/document/apply', {
      expectedRevision,
      operations: [{ type: 'node.update', id: 'n-home-choice-kicker', text }],
    })
  expect(await (await apply(template.revision))!.json()).toMatchObject({
    revision: template.revision + 1,
  })
  const { document, revision } = await (await request('/api/sites/try/document'))!.json()
  expect(revision).toBe(template.revision + 1)
  expect(document.nodes['n-home-choice-kicker'].text).toEqual(text)
  const preview = await (await request('/api/sites/try/preview?page=p-home'))!.json()
  expect(preview.html).toContain('Edited in the browser')
  const stale = (await apply(template.revision))!
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ currentRevision: template.revision + 1 })
  expect((await request('/api/sites/try/preview?page=missing'))!.status).toBe(404)
})

it('stages an upload and serves its bytes once registered', async () => {
  const request = site()
  const upload = await (await request('/api/sites/try/assets/upload', {
    name: 'pixel.png',
    data: pixel,
  }))!.json()
  expect(upload).toMatchObject({ kind: 'image', mime: 'image/png' })
  const route = `/api/sites/try/assets/${upload.hash}`
  expect((await request(route))!.status).toBe(404)
  await request('/api/sites/try/document/apply', {
    expectedRevision: template.revision,
    operations: [{ type: 'asset.create', ...upload }],
  })
  const served = (await request(route))!
  expect(served.headers.get('content-type')).toBe('image/png')
  expect(served.headers.get('x-content-type-options')).toBe('nosniff')
  expect(Buffer.from(await served.arrayBuffer()).toString('base64')).toBe(pixel)
  const unknown = await request('/api/sites/try/assets/upload', {
    name: 'fake.png',
    data: btoa('<script>'),
  })
  expect(unknown!.status).toBe(415)
})

it('answers releases, connections and events, and leaves other requests alone', async () => {
  const request = site()
  expect(await (await request('/api/sites/try/releases'))!.json()).toEqual({
    enabled: false,
    releases: [],
  })
  expect(await (await request('/api/sites/try/connections'))!.json()).toEqual([])
  const events = (await request('/api/sites/try/events'))!
  expect(events.headers.get('content-type')).toBe('text/event-stream')
  expect(events.headers.get('cache-control')).toBe('no-store')
  expect(await request('/assets/x.js')).toBeUndefined()
})

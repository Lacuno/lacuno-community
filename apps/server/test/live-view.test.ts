import { expect, it } from 'vitest'
import { siteEvents } from '../src/events.js'
import { editor } from './harness.js'

/** A new paragraph at the top of the home page's main, as a second client would add it. */
const paragraph = (id: string, text: string) => ({
  type: 'node.create',
  parent: 'n-home-main',
  index: 0,
  node: {
    id,
    type: 'text',
    tag: 'p',
    classes: [],
    text: { type: 'static', value: text },
    children: [],
  },
})

it('streams committed batches, replaying the ones after ?since', async () => {
  const { api, document, siteId } = await editor()
  const start = (await document()).revision
  const apply = async (id: string, expectedRevision: number) => {
    const response = await api(`/api/sites/${siteId}/document/apply`, {
      expectedRevision,
      operations: [paragraph(id, id)],
    })
    expect(response.status).toBe(200)
  }
  await apply('n-live-early', start)
  const stream = await api(`/api/sites/${siteId}/events?since=${start}`)
  expect(stream.headers.get('content-type')).toBe('text/event-stream')
  expect(stream.headers.get('cache-control')).toBe('no-store')
  const reader = stream.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  const next = async () => {
    while (!buffer.includes('\n\n')) buffer += (await reader.read()).value
    const [message, ...rest] = buffer.split('\n\n')
    buffer = rest.join('\n\n')
    const field = (name: string) =>
      message!
        .split('\n')
        .find((line) => line.startsWith(`${name}: `))!
        .slice(name.length + 2)
    return { event: field('event'), id: field('id'), data: JSON.parse(field('data')) }
  }
  const replayed = await next()
  expect(replayed).toMatchObject({ event: 'batch', id: String(start + 1) })
  expect(replayed.data).toMatchObject({
    revision: start + 1,
    actor: { kind: 'editor' },
    summary: '1 operation: node.create',
  })
  await apply('n-live-late', start + 1)
  expect((await next()).data.revision).toBe(start + 2)
  await reader.cancel()
})

it('lands outside batches on the open canvas, queueing them behind a save in flight', async () => {
  const { page, canvas, api, document, siteId, saved } = await editor()
  const conflict = page.getByText('changed in another session')
  const apply = (expectedRevision: number, operations: unknown[]) =>
    api(`/api/sites/${siteId}/document/apply`, { expectedRevision, operations })

  // A second client's batch shows up without a reload and without a conflict.
  expect(
    (await apply((await document()).revision, [paragraph('n-live-1', 'From outside')])).status,
  ).toBe(200)
  await expect
    .poll(() => canvas.locator('[data-lacuno-node="n-live-1"]').textContent())
    .toBe('From outside')
  expect(await conflict.count()).toBe(0)

  // The editor's own save is in flight when the outside batch lands on top of it: the batch
  // waits in the queue and applies once the save's response arrives.
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.click()
  await page.route(
    '**/document/apply',
    async (route) => {
      const response = await route.fetch()
      const { revision } = (await response.json()) as { revision: number }
      expect((await apply(revision, [paragraph('n-live-2', 'Queued')])).status).toBe(200)
      // The stream has sent the outside batch before the editor learns its save landed.
      await page.evaluate(
        ({ siteId, revision }) =>
          new Promise((resolve) => {
            const source = new EventSource(`/api/sites/${siteId}/events?since=${revision}`)
            source.addEventListener('batch', () => resolve(source.close()))
          }),
        { siteId, revision },
      )
      await route.fulfill({ response })
    },
    { times: 1 },
  )
  await page.getByLabel('Text', { exact: true }).fill('Saved first')
  await saved()
  await expect
    .poll(() => canvas.locator('[data-lacuno-node="n-live-2"]').textContent())
    .toBe('Queued')
  expect(await heading.textContent()).toBe('Saved first')
  expect(await conflict.count()).toBe(0)

  // The editor keeps saving on top of the batches it took in.
  await page.getByLabel('Text', { exact: true }).fill('Saved after')
  await saved()
  expect((await document()).nodes['n-home-title']).toMatchObject({
    text: { type: 'static', value: 'Saved after' },
  })
  expect(await conflict.count()).toBe(0)

  // An agent's batch outlines the nodes it touched for about a second. Emitted directly as a
  // stand-in for the MCP endpoint, for the node the designer is not editing.
  const current = (await document()).revision
  siteEvents.emit(siteId, {
    revision: current + 1,
    patches: [{ op: 'set', path: ['nodes', 'n-live-1', 'classes'], value: [] }],
    actor: { kind: 'agent', app: 'Test agent' },
    at: Date.now(),
    summary: '1 change',
  })
  await canvas.locator('.flash > div').waitFor()
  await canvas.locator('.flash > div').waitFor({ state: 'detached' })
})

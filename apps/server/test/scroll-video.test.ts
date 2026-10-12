/// <reference lib="dom" />
import type { Document } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { editor, openInspectorTab } from './harness.js'

it('inserts a scroll video that follows the scroll in Preview and publishes muted', async () => {
  const { server, context, origin, siteId, page, canvas, document, publish, saved } = await editor({
    width: 1400,
    height: 900,
  })
  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  await page.getByLabel('Upload image, video or font', { exact: true }).setInputFiles({
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('AAAAGGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQ==', 'base64'),
  })
  await page.getByRole('button', { name: 'Insert clip.mp4', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Scroll video', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await saved()

  // A story whose stage holds a scroll video and two steps.
  const stageOf = (doc: Document) => {
    const story = Object.values(doc.nodes).find((node) => node.attrs?.['data-lc-story'])!
    return doc.nodes[story.children[0]!]!
  }
  const [video, ...steps] = stageOf(await document()).children
  expect((await document()).nodes[video!]).toMatchObject({
    tag: 'video',
    attrs: { 'data-lc-scrub': { type: 'static', value: true } },
  })
  expect(steps).toHaveLength(2)

  // Its clip is chosen like any video's; Follow scroll hides the playback flags.
  await canvas.locator(`[data-lacuno-node="${video}"]`).click()
  await openInspectorTab(page, 'Content')
  await page.getByRole('button', { name: 'Choose video', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Video library' })
    .getByRole('button', { name: 'Choose clip.mp4', exact: true })
    .click()
  await saved()
  const clip = canvas.locator(`video[data-lacuno-node="${video}"][src]`)
  await clip.waitFor()
  const follow = page.getByLabel('Follow scroll', { exact: true })
  const controls = page.getByLabel('Controls', { exact: true })
  expect(await follow.isChecked()).toBe(true)
  expect(await controls.count()).toBe(0)
  await follow.click()
  await saved()
  await controls.waitFor()
  expect((await document()).nodes[video!]?.attrs?.['data-lc-scrub']).toBeUndefined()
  await follow.click()
  await saved()
  await expect.poll(() => controls.count()).toBe(0)
  expect((await document()).nodes[video!]?.attrs?.['data-lc-scrub']).toEqual({
    type: 'static',
    value: true,
  })

  // The clip here does not decode: it reports ten seconds and keeps the time it is given. In
  // Preview its time follows the story; leaving rewinds it.
  await clip.evaluate((element) => {
    Object.defineProperty(element, 'duration', { value: 10 })
    Object.defineProperty(element, 'currentTime', { value: 0, writable: true })
  })
  const time = () => clip.evaluate((element: HTMLVideoElement) => element.currentTime)
  await page.getByRole('button', { name: 'Preview motion', exact: true }).click()
  await expect.poll(() => canvas.locator('html').getAttribute('data-lacuno-still')).toBeNull()
  await canvas.locator('[data-lc-story]').evaluate((element) => {
    const view = element.ownerDocument.defaultView!
    const box = element.getBoundingClientRect()
    view.scrollBy(0, box.top + (box.height - view.innerHeight) / 2)
  })
  await expect.poll(async () => Math.round(await time())).toBe(5)
  await page.keyboard.press('Escape')
  await expect.poll(time).toBe(0)

  const live = await publish()
  const published = await (await server.published!.request(`${live}/`)).text()
  expect(published).toMatch(
    /<video class="[^"]+" data-lacuno-motion="scroll" data-lc-scrub muted playsinline preload="metadata" src="\/assets\/[a-f0-9]{64}\.mp4"><\/video>/,
  )
  expect(published).toContain('scrubVideos')

  // Outside a story nothing sets a video's time: Follow scroll is not offered and is ignored.
  const story = stageOf(await document()).parent!
  const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: (await document()).revision,
      operations: [{ type: 'node.update', id: story, attrs: {} }],
    },
  })
  expect(response.status()).toBe(200)
  await controls.waitFor()
  expect(await follow.count()).toBe(0)
  const loose = await (await server.published!.request(`${await publish()}/`)).text()
  expect(loose).toMatch(/<video class="[^"]+" data-lacuno-motion="scroll" data-lc-scrub src=/)
  expect(loose).not.toContain('scrubVideos')
}, 240_000)

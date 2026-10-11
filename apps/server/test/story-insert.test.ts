import type { Document } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('inserts a scroll story whose steps edit in place and renumber on publish', async () => {
  const { server, page, canvas, document, publish, saved } = await editor({
    width: 1400,
    height: 900,
  })
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Scroll story', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await saved()

  // A marked section, a stage holding a picture placeholder and three steps.
  const stageOf = (doc: Document) => {
    const story = Object.values(doc.nodes).find((node) => node.attrs?.['data-lc-story'])!
    return doc.nodes[story.children[0]!]!
  }
  const doc = await document()
  const stage = stageOf(doc)
  const [image, ...steps] = stage.children
  expect(doc.nodes[image!]).toMatchObject({ tag: 'img' })
  expect(steps).toHaveLength(3)
  const node = (id: string) => canvas.locator(`[data-lacuno-node="${id}"]`)
  await expect.poll(() => node(image!).getAttribute('data-lacuno-image-placeholder')).toBe('')

  // In edit mode the steps follow each other, and each takes a click.
  const boxes = await Promise.all(steps.map(async (id) => (await node(id).boundingBox())!))
  for (const [i, box] of boxes.slice(1).entries())
    expect(box.y).toBeGreaterThanOrEqual(boxes[i]!.y + boxes[i]!.height)
  for (const id of steps) {
    const heading = node(id).locator('h2')
    await heading.click()
    await expect.poll(() => heading.getAttribute('data-lacuno-selected')).toBe('')
  }

  // In Preview the picture stays and the second step has its turn midway.
  const story = canvas.locator('[data-lc-story]')
  const opacity = (id: string) =>
    node(id).evaluate((element) => Number(getComputedStyle(element).opacity))
  await page.getByRole('button', { name: 'Preview motion', exact: true }).click()
  await expect.poll(() => canvas.locator('html').getAttribute('data-lacuno-still')).toBeNull()
  await story.evaluate((element) => {
    const box = element.getBoundingClientRect()
    element.ownerDocument.defaultView!.scrollBy(0, box.top + box.height / 2 - innerHeight / 2)
  })
  await expect
    .poll(async () => (await Promise.all(steps.map(opacity))).map(Math.round))
    .toEqual([0, 1, 0])
  expect(await opacity(image!)).toBe(1)
  await page.keyboard.press('Escape')

  // The first step's parent from its heading, duplicated and moved below the second step.
  await node(steps[0]!).locator('h2').click()
  await page.locator('aside.inspector .inspector-parent').click()
  await expect.poll(() => node(steps[0]!).getAttribute('data-lacuno-selected')).toBe('')
  await page.keyboard.press('ControlOrMeta+d')
  await saved()
  await page.keyboard.press('Alt+ArrowDown')
  await saved()
  const copy = stageOf(await document()).children[3]!
  expect(stageOf(await document()).children).toEqual([image, steps[0], steps[1], copy, steps[2]])

  const live = await publish()
  const published = await (await server.published!.request(`${live}/`)).text()
  expect(published).toContain('data-lc-steps="4"')
  expect(
    [...published.matchAll(/data-lc-step="(\d)"[^>]*><h2[^>]*>([^<]*)/g)].map((m) => m.slice(1)),
  ).toEqual([
    ['1', 'Meet the story.'],
    ['2', 'One idea at a time.'],
    ['3', 'Meet the story.'],
    ['4', 'Make it yours.'],
  ])
  const sheets = await Promise.all(
    [...published.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(async ([, href]) =>
      (await server.published!.request(new URL(href!, `${live}/`).href)).text(),
    ),
  )
  // Minified, wherever the build put the stylesheet.
  expect([published, ...sheets].join('\n').match(/view-timeline-name:\s*--lc-story/g)).toHaveLength(
    1,
  )
}, 240_000)

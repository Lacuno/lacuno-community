import type { Page } from 'playwright'
import { expect, it } from 'vitest'
import {
  center,
  childIds,
  grabPoint,
  hold,
  type Point,
  parentOf,
  dragSession as session,
} from './harness.js'

const drag = async (page: Page, from: Point, to: Point) => (await hold(page, from, to)).release()

/** A Row of three short tiles with room above and below them and a gap between, before the hero. */
async function rowOfTiles(launched: Awaited<ReturnType<typeof session>>) {
  const { page, canvas, context, origin, siteId, document } = launched
  const style = (cls: string, property: string, value: string) => ({
    type: 'style.set',
    class: cls,
    breakpoint: 'base',
    state: 'none',
    property,
    value: { type: 'raw', value },
  })
  const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: (await document()).revision,
      operations: [
        { type: 'class.create', id: 'c-row', local: true },
        { type: 'class.create', id: 'c-tile', local: true },
        ...Object.entries({
          display: 'flex',
          gap: '24px',
          height: '200px',
          padding: '0',
          width: '600px',
        }).map(([k, v]) => style('c-row', k, v)),
        ...Object.entries({ height: '40px', width: '120px', margin: '0', background: '#ddd' }).map(
          ([k, v]) => style('c-tile', k, v),
        ),
        {
          type: 'node.create',
          parent: 'n-home-main',
          index: 0,
          node: {
            id: 'n-row',
            type: 'element',
            tag: 'section',
            classes: ['c-row'],
            children: [1, 2, 3].map((i) => ({
              id: `n-tile-${i}`,
              type: 'text',
              tag: 'p',
              classes: ['c-tile'],
              text: { type: 'static', value: `Tile ${i}` },
              children: [],
            })),
          },
        },
      ],
    },
  })
  expect(response.status()).toBe(200)
  await page.reload()
  await canvas.locator('#lacuno-selection-overlay').waitFor({ state: 'attached' })
  await launched.node('n-tile-1').scrollIntoViewIfNeeded()
}

/** The declarations the saved document holds for a node's classes, by property. */
const committed = async (
  document: () => Promise<{ nodes: Record<string, { classes: string[] }>; styles: object }>,
  id: string,
) => {
  const doc = await document()
  return Object.fromEntries(
    (Object.values(doc.styles) as { class: string; property: string; value: unknown }[])
      .filter((style) => doc.nodes[id]!.classes.includes(style.class))
      .map((style) => [style.property, style.value]),
  )
}

it('aligns a dropped item to the band it lands in, in one write and one undo step', async () => {
  const launched = await session()
  const { page, canvas, node, undo, saved, writes, document, errors } = launched
  await rowOfTiles(launched)
  const row = (await node('n-row').boundingBox())!
  const second = (await node('n-tile-2').boundingBox())!
  const computed = (id: string, property: string) =>
    node(id).evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property)
  // The bottom third between the second and third tile: after the second, aligned to the end.
  await drag(page, await grabPoint(node('n-tile-1')), {
    x: second.x + second.width + 12,
    y: row.y + row.height * 0.8,
  })
  await expect.poll(() => childIds(canvas, 'n-row')).toEqual(['n-tile-2', 'n-tile-1', 'n-tile-3'])
  await saved()
  expect(writes()).toBe(1)
  expect(await computed('n-tile-1', 'align-self')).toBe('flex-end')
  expect((await committed(document, 'n-tile-1'))['align-self']).toEqual({
    type: 'keyword',
    value: 'flex-end',
  })
  expect((await node('n-tile-1').boundingBox())!.y).toBeGreaterThan(row.y + row.height / 2)
  await undo()
  await expect.poll(() => childIds(canvas, 'n-row')).toEqual(['n-tile-1', 'n-tile-2', 'n-tile-3'])
  expect(await computed('n-tile-1', 'align-self')).not.toBe('flex-end')
  expect((await committed(document, 'n-tile-1'))['align-self']).toBeUndefined()
  // The same band again writes nothing new: the alignment is what it already is.
  await drag(page, await grabPoint(node('n-tile-3')), {
    x: second.x + second.width + 12,
    y: row.y + row.height * 0.5,
  })
  await saved()
  expect((await committed(document, 'n-tile-3'))['align-self']).toEqual({
    type: 'keyword',
    value: 'center',
  })
  await drag(page, await grabPoint(node('n-tile-3')), {
    x: second.x - 12,
    y: row.y + row.height * 0.5,
  })
  await expect.poll(() => childIds(canvas, 'n-row')).toEqual(['n-tile-1', 'n-tile-3', 'n-tile-2'])
  await saved()
  // Three drops and the undo, each one request.
  expect(writes()).toBe(4)
  expect((await committed(document, 'n-tile-3'))['align-self']).toEqual({
    type: 'keyword',
    value: 'center',
  })
  expect(errors).toEqual([])
}, 60_000)

it('reorders a stretched Stack child plainly, with no band to align to', async () => {
  const { page, canvas, node, saved, writes, document } = await session()
  await node('n-home-note-top').scrollIntoViewIfNeeded()
  // The note is a Stack whose paragraphs fill its width: the drop is a reorder, nothing else.
  await drag(
    page,
    await grabPoint(node('n-home-note-copy')),
    await center(node('n-home-note-top'), 0.5, 0.2),
  )
  await expect
    .poll(() => childIds(canvas, 'n-home-hero-note'))
    .toEqual(['n-home-note-copy', 'n-home-note-top'])
  await saved()
  expect(writes()).toBe(1)
  expect((await committed(document, 'n-home-note-copy'))['align-self']).toBeUndefined()
}, 60_000)

it('pushes an item to the end with an auto margin that a later drop clears', async () => {
  const launched = await session()
  const { page, canvas, node, saved, writes, document } = launched
  await rowOfTiles(launched)
  const row = (await node('n-row').boundingBox())!
  const third = (await node('n-tile-3').boundingBox())!
  const marginLeft = () =>
    node('n-tile-3').evaluate((element) => Number.parseFloat(getComputedStyle(element).marginLeft))
  // Past the last tile by more than the gap: it stays last and moves to the row's far end.
  await drag(page, await grabPoint(node('n-tile-3')), {
    x: third.x + third.width + 24 + 40,
    y: row.y + row.height / 2,
  })
  await saved()
  expect(writes()).toBe(1)
  expect((await committed(document, 'n-tile-3'))['margin-left']).toEqual({
    type: 'keyword',
    value: 'auto',
  })
  await expect.poll(marginLeft).toBeGreaterThan(100)
  expect((await node('n-tile-3').boundingBox())!.x + third.width).toBeCloseTo(row.x + row.width, 0)
  expect(await childIds(canvas, 'n-row')).toEqual(['n-tile-1', 'n-tile-2', 'n-tile-3'])
  // Dropped between the first two, it is an ordinary item again.
  const second = (await node('n-tile-2').boundingBox())!
  await drag(page, await grabPoint(node('n-tile-3')), {
    x: second.x - 12,
    y: row.y + row.height / 2,
  })
  await expect.poll(() => childIds(canvas, 'n-row')).toEqual(['n-tile-1', 'n-tile-3', 'n-tile-2'])
  await saved()
  expect(writes()).toBe(2)
  expect((await committed(document, 'n-tile-3'))['margin-left']).toBeUndefined()
  expect(await marginLeft()).toBe(0)
}, 60_000)

it('makes a Row of two Stack siblings from a drop on the side of one, in the dropped order', async () => {
  const { page, canvas, node, label, shown, indicator, saved, writes, undo, document } =
    await session()
  await node('n-home-note-top').scrollIntoViewIfNeeded()
  const top = (await node('n-home-note-top').boundingBox())!
  const copy = (await node('n-home-note-copy').boundingBox())!
  const held = await hold(page, await grabPoint(node('n-home-note-copy')), {
    x: top.x + top.width * 0.1,
    y: top.y + top.height / 2,
  })
  await expect.poll(shown).toBe('block')
  expect(await label()).toBe('Row with Paragraph')
  // The sibling is outlined and the ghost stands beside it, as tall as it is.
  const outline = (await indicator.locator('div').nth(0).boundingBox())!
  expect(outline.x).toBeCloseTo(top.x, 0)
  expect(outline.width).toBeCloseTo(top.width, 0)
  const ghost = (await indicator.locator('[data-lacuno-ghost]').boundingBox())!
  expect(ghost.x + ghost.width).toBeCloseTo(top.x, 0)
  expect(ghost.height).toBeCloseTo(top.height, 0)
  expect(ghost.width).toBeCloseTo(copy.width, 0)
  await held.release()
  await expect.poll(() => parentOf(canvas, 'n-home-note-top')).not.toBe('n-home-hero-note')
  await saved()
  expect(writes()).toBe(1)
  const rowId = (await parentOf(canvas, 'n-home-note-top'))!
  expect(await childIds(canvas, 'n-home-hero-note')).toEqual([rowId])
  expect(await childIds(canvas, rowId)).toEqual(['n-home-note-copy', 'n-home-note-top'])
  expect(
    await node(rowId).evaluate((element) => {
      const style = getComputedStyle(element)
      return [style.display, style.flexDirection]
    }),
  ).toEqual(['flex', 'row'])
  expect((await document()).nodes[rowId]).toMatchObject({ tag: 'div', meta: { label: 'Row' } })
  await undo()
  await expect
    .poll(() => childIds(canvas, 'n-home-hero-note'))
    .toEqual(['n-home-note-top', 'n-home-note-copy'])
  expect((await document()).nodes[rowId]).toBeUndefined()
}, 60_000)

it('shows the siblings, the ghost and a gap-sized bar while dragging in a Row', async () => {
  const launched = await session()
  const { page, node, indicator, shown } = launched
  await rowOfTiles(launched)
  const row = (await node('n-row').boundingBox())!
  const first = (await node('n-tile-1').boundingBox())!
  const second = (await node('n-tile-2').boundingBox())!
  const third = (await node('n-tile-3').boundingBox())!
  const held = await hold(page, await grabPoint(node('n-tile-1')), {
    x: second.x + second.width + 12,
    y: row.y + row.height * 0.5,
  })
  await expect.poll(shown).toBe('block')
  // The other two tiles are outlined faintly; the dragged one is not.
  const siblings = indicator.locator('[data-lacuno-sibling]')
  await expect.poll(() => siblings.count()).toBe(2)
  expect((await siblings.nth(0).boundingBox())!.x).toBeCloseTo(second.x, 0)
  expect((await siblings.nth(1).boundingBox())!.x).toBeCloseTo(third.x, 0)
  // The ghost is the dragged tile's size, centred on the line and in the row's middle band.
  const ghost = (await indicator.locator('[data-lacuno-ghost]').boundingBox())!
  expect(ghost.width).toBeCloseTo(first.width, 0)
  expect(ghost.height).toBeCloseTo(first.height, 0)
  expect(ghost.x + ghost.width / 2).toBeCloseTo((second.x + second.width + third.x) / 2, 0)
  expect(ghost.y + ghost.height / 2).toBeCloseTo(row.y + row.height / 2, 0)
  // The bar fills the 24 px gap between the tiles, measured in the canvas's own pixels.
  const bar = indicator.locator('div').nth(1)
  expect(await bar.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(24, 0)
  expect((await bar.boundingBox())!.x).toBeCloseTo(second.x + second.width, 0)
  expect(await indicator.locator('[data-lacuno-flow]').textContent()).toBe('→')
  await held.cancel()
  await expect.poll(shown).toBe('none')
}, 60_000)

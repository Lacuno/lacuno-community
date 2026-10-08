import type { Page } from 'playwright'
import { expect, it } from 'vitest'
import {
  center,
  childIds,
  grabPoint,
  hold,
  openFormatting,
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
        { type: 'class.create', id: 'c-tile', name: 'Test tile', local: false },
        ...[1, 2, 3].map((i) => ({ type: 'class.create', id: `c-tile-${i}`, local: true })),
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
              classes: ['c-tile', `c-tile-${i}`],
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

it('drops without alignment edits, then aligns explicitly on each axis with separate undo steps', async () => {
  const launched = await session()
  const { page, canvas, node, saved, writes, undo, document, errors, shot } = launched
  await rowOfTiles(launched)
  const originalStyles = (await document()).styles
  const row = (await node('n-row').boundingBox())!
  const second = (await node('n-tile-2').boundingBox())!
  await drag(page, await grabPoint(node('n-tile-1')), {
    x: second.x + second.width + 12,
    y: row.y + row.height * 0.8,
  })
  await expect.poll(() => childIds(canvas, 'n-row')).toEqual(['n-tile-2', 'n-tile-1', 'n-tile-3'])
  await saved()
  expect(writes()).toBe(1)
  expect((await document()).styles).toEqual(originalStyles)
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  await expect.poll(() => menu.isVisible()).toBe(true)
  const selectedBox = (await node('n-tile-1').boundingBox())!
  const menuBox = (await menu.boundingBox())!
  expect(
    menuBox.y >= selectedBox.y + selectedBox.height ||
      menuBox.y + menuBox.height <= selectedBox.y ||
      menuBox.x >= selectedBox.x + selectedBox.width ||
      menuBox.x + menuBox.width <= selectedBox.x,
  ).toBe(true)
  await shot('alignment-controls')
  await menu.getByRole('button', { name: 'Vertical: Bottom', exact: true }).click()
  await saved()
  expect(writes()).toBe(2)
  expect((await committed(document, 'n-tile-1'))['align-self']).toEqual({
    type: 'keyword',
    value: 'flex-end',
  })
  await expect
    .poll(() => menu.getByRole('button', { name: 'Vertical: Bottom' }).getAttribute('aria-pressed'))
    .toBe('true')
  await menu.getByRole('button', { name: 'Horizontal: Right', exact: true }).click()
  await saved()
  expect(writes()).toBe(3)
  await shot('alignment-changed')
  expect(await committed(document, 'n-tile-1')).toMatchObject({
    'align-self': { type: 'keyword', value: 'flex-end' },
    'margin-left': { type: 'keyword', value: 'auto' },
  })
  expect((await committed(document, 'n-tile-2'))['align-self']).toBeUndefined()
  expect((await committed(document, 'n-tile-3'))['margin-left']).toBeUndefined()
  await undo()
  await saved()
  expect((await committed(document, 'n-tile-1'))['margin-left']).toBeUndefined()
  expect((await committed(document, 'n-tile-1'))['align-self']).toEqual({
    type: 'keyword',
    value: 'flex-end',
  })
  await undo()
  await saved()
  expect((await document()).styles).toEqual(originalStyles)
  await undo()
  await expect.poll(() => childIds(canvas, 'n-row')).toEqual(['n-tile-1', 'n-tile-2', 'n-tile-3'])
  expect(errors).toEqual([])
}, 60_000)

it('offers alignment after a drop in the original slot without writing a no-op move', async () => {
  const launched = await session()
  const { page, canvas, node, document, writes } = launched
  await rowOfTiles(launched)
  const revision = (await document()).revision
  const row = (await node('n-row').boundingBox())!
  const third = (await node('n-tile-3').boundingBox())!
  await drag(page, await grabPoint(node('n-tile-3')), {
    x: third.x + third.width - 10,
    y: row.y + row.height * 0.5,
  })
  await expect
    .poll(() => canvas.getByRole('dialog', { name: 'Align within parent' }).isVisible())
    .toBe(true)
  expect(writes()).toBe(0)
  expect((await document()).revision).toBe(revision)
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

it('preserves explicit auto margins and alignment when an item is reordered', async () => {
  const launched = await session()
  const { page, canvas, node, saved, document } = launched
  await rowOfTiles(launched)
  await node('n-tile-3').dispatchEvent('click')
  await canvas.getByRole('button', { name: 'Align', exact: true }).click()
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  await menu.getByRole('button', { name: 'Horizontal: Right', exact: true }).click()
  await saved()
  await menu.getByRole('button', { name: 'Vertical: Bottom', exact: true }).click()
  await saved()
  await page.keyboard.press('Escape')
  const before = (await document()).styles
  const second = (await node('n-tile-2').boundingBox())!
  const row = (await node('n-row').boundingBox())!
  await drag(page, await grabPoint(node('n-tile-3')), {
    x: second.x - 12,
    y: row.y + row.height * 0.5,
  })
  await expect.poll(() => childIds(canvas, 'n-row')).toEqual(['n-tile-1', 'n-tile-3', 'n-tile-2'])
  await saved()
  expect((await document()).styles).toEqual(before)

  // Returning to flow on Tablet overrides inherited Desktop auto margins without erasing them.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Tablet', exact: true }).click()
  await node('n-tile-3').scrollIntoViewIfNeeded()
  await canvas.getByRole('button', { name: 'Align', exact: true }).click()
  await menu.getByRole('button', { name: 'Horizontal: In flow', exact: true }).click()
  await saved()
  expect(
    await node('n-tile-3').evaluate((el) => String(el.computedStyleMap().get('margin-left'))),
  ).toBe('0px')
  const styles = (await document()).styles
  for (const [key, value] of Object.entries(before)) expect(styles[key]).toEqual(value)
  expect(
    Object.values(styles).filter(
      (style) => style.class === 'c-tile-3' && style.breakpoint === 'tablet',
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        property: 'margin-left',
        value: { type: 'unit', value: 0, unit: 'px' },
      }),
      expect.objectContaining({
        property: 'margin-right',
        value: { type: 'unit', value: 0, unit: 'px' },
      }),
    ]),
  )
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await expect
    .poll(() => node('n-tile-3').evaluate((el) => String(el.computedStyleMap().get('margin-left'))))
    .toBe('auto')
}, 60_000)

it('makes a Row of two Stack siblings once rested on the side of one, in the dropped order', async () => {
  const { page, canvas, node, label, shown, indicator, saved, writes, undo, document } =
    await session()
  await node('n-home-note-top').scrollIntoViewIfNeeded()
  const top = (await node('n-home-note-top').boundingBox())!
  const held = await hold(page, await grabPoint(node('n-home-note-copy')), {
    x: top.x + top.width * 0.1,
    y: top.y + top.height / 2,
  })
  await expect.poll(shown).toBe('block')
  // Passing over the side reorders within the Stack and says what resting there would do.
  expect(await label()).toBe('Hold for a Row with Paragraph')
  await held.rest(1200)
  await expect.poll(label).toBe('Row with Paragraph')
  // The side rail marks the new Row inside the sibling's bounds, without an off-canvas ghost.
  const outline = (await indicator.locator('[data-lacuno-drop-parent]').boundingBox())!
  expect(outline.x).toBeCloseTo(top.x, 0)
  expect(outline.width).toBeCloseTo(top.width, 0)
  expect(await indicator.locator('[data-lacuno-ghost]').count()).toBe(0)
  const rail = (await indicator.locator('[data-lacuno-insertion]').boundingBox())!
  expect(rail.x).toBeCloseTo(top.x - 1, 0)
  await held.release(true)
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
  // The Row never wraps, so the two paragraphs share the line however wide their text is.
  const copy = (await node('n-home-note-copy').boundingBox())!
  const topNow = (await node('n-home-note-top').boundingBox())!
  expect(copy.y).toBeCloseTo(topNow.y, 0)
  expect(copy.x + copy.width).toBeLessThanOrEqual(topNow.x + 1)
  await undo()
  await expect
    .poll(() => childIds(canvas, 'n-home-hero-note'))
    .toEqual(['n-home-note-top', 'n-home-note-copy'])
  expect((await document()).nodes[rowId]).toBeUndefined()
}, 60_000)

it('shows only the target and a two-screen-pixel insertion line while dragging', async () => {
  const launched = await session()
  const { page, node, indicator, shown } = launched
  await rowOfTiles(launched)
  const row = (await node('n-row').boundingBox())!
  const second = (await node('n-tile-2').boundingBox())!
  const held = await hold(page, await grabPoint(node('n-tile-1')), {
    x: second.x + second.width + 12,
    y: row.y + row.height * 0.5,
  })
  await expect.poll(shown).toBe('block')
  expect(
    await indicator
      .locator('[data-lacuno-ghost], [data-lacuno-sibling], [data-lacuno-flow]')
      .count(),
  ).toBe(0)
  expect((await indicator.locator('[data-lacuno-insertion]').boundingBox())!.width).toBeCloseTo(
    2,
    0,
  )
  await held.cancel()
  await expect.poll(shown).toBe('none')
}, 60_000)

it('makes a Row with a card from its outer quarter and drops inside it from its middle', async () => {
  const { page, canvas, node, label, saved, undo } = await session()
  const card = 'n-home-choice-hosted-top'
  const link = 'n-home-choice-hosted-link'
  await node(card).evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const box = (await node(card).boundingBox())!
  const side = await hold(page, await grabPoint(node(link)), {
    x: box.x + box.width * 0.1,
    y: box.y + box.height / 2,
  })
  await expect.poll(label).toBe('Hold for a Row with Container')
  await side.rest(1200)
  await expect.poll(label).toBe('Row with Container')
  await side.release(true)
  await expect.poll(() => parentOf(canvas, card)).not.toBe('n-home-choice-hosted')
  await saved()
  const rowId = (await parentOf(canvas, card))!
  expect(await childIds(canvas, rowId)).toEqual([link, card])
  await undo()
  await expect.poll(() => childIds(canvas, 'n-home-choice-hosted')).toEqual([card, link])
  // Its inner half still takes the drop inside, after the same rest.
  const inside = await hold(page, await grabPoint(node(link)), await center(node(card)))
  await expect.poll(label).toBe('Hold to drop inside Container')
  await inside.rest(1200)
  await expect.poll(label).toBe('Container')
  await inside.release(true)
  await expect.poll(() => parentOf(canvas, link)).toBe(card)
}, 60_000)

it('keeps a drag in its own container at an edge that would leave another', async () => {
  const { page, canvas, node, label, saved } = await session()
  const aside = 'n-home-hero-note'
  await node('n-home-note-top').scrollIntoViewIfNeeded()
  const box = (await node(aside).boundingBox())!
  const top = (await node('n-home-note-top').boundingBox())!
  // 12 px inside the aside's right edge, where another element would be dropped beside it.
  const held = await hold(page, await grabPoint(node('n-home-note-copy')), {
    x: box.x + box.width - 12,
    y: top.y + top.height * 0.25,
  })
  await expect.poll(label).toBe('aside')
  await held.release()
  await expect.poll(() => childIds(canvas, aside)).toEqual(['n-home-note-copy', 'n-home-note-top'])
  await saved()
  expect(await parentOf(canvas, 'n-home-note-copy')).toBe(aside)
}, 60_000)

it('says why a form field cannot be dropped where it is, and drops nothing', async () => {
  const { page, node, label, shown, writes, errors } = await session()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const tile = page.locator('[data-drag-preset="email-field"]')
  await tile.scrollIntoViewIfNeeded()
  // The drag starts in the editor's own document and crosses into the canvas.
  const from = await center(tile)
  const held = await hold(page, from, { x: from.x + 30, y: from.y + 30 })
  await held.move(await center(node('n-home-hero-copy')), 40)
  await expect.poll(shown).toBe('block')
  expect(await label()).toBe('Place form fields inside a form.')
  await held.release()
  await expect.poll(shown).toBe('none')
  expect(writes()).toBe(0)
  expect(errors).toEqual([])
}, 60_000)

it('flushes a pending inspector draft on the drop instead of refusing the drag', async () => {
  const launched = await session()
  const { page, canvas, node, saved, writes } = launched
  await rowOfTiles(launched)
  await node('n-tile-1').dispatchEvent('click')
  await openFormatting(page, 'Spacing & shape')
  await page.getByLabel('Inside spacing top', { exact: true }).fill('12')
  const row = (await node('n-row').boundingBox())!
  const second = (await node('n-tile-2').boundingBox())!
  await drag(page, await grabPoint(node('n-tile-1')), {
    x: second.x + second.width + 12,
    y: row.y + row.height * 0.5,
  })
  await expect.poll(() => childIds(canvas, 'n-row')).toEqual(['n-tile-2', 'n-tile-1', 'n-tile-3'])
  await saved()
  // The draft and the move are two saves, so two undo steps.
  await expect.poll(writes).toBe(2)
  expect(await node('n-tile-1').evaluate((el) => getComputedStyle(el).paddingTop)).toBe('12px')
}, 60_000)

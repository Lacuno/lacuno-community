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

it('reorders sections by exactly one place, with nothing moving until the drop', async () => {
  const { page, canvas, node, shown, label, undo, shot, writes, errors, saved } = await session()
  const main = await childIds(canvas, 'n-home-main')
  const moved = 'n-home-features-intro'
  const next = main[main.indexOf(moved) + 1]!
  await node(moved).evaluate((element) => element.scrollIntoView({ block: 'start' }))
  const boxes = () =>
    Promise.all(main.filter((id) => id !== moved).map(async (id) => node(id).boundingBox()))
  const before = await boxes()
  const target = (await node(next).boundingBox())!
  // Over the next section's middle: its outer quarters would offer a Row with it instead.
  const from = await grabPoint(node(moved))
  const held = await hold(page, from, {
    x: target.x + target.width / 2,
    y: target.y + target.height * 0.75,
  })
  await expect.poll(shown).toBe('block')
  expect(await label()).toBe('main')
  // The page keeps its layout: the dragged section dims in place and no sibling shifts.
  expect(await boxes()).toEqual(before)
  expect(await node(moved).evaluate((element) => getComputedStyle(element).opacity)).toBe('0.4')
  await shot('section-down')
  expect(writes()).toBe(0)
  await held.release()
  const down = [...main]
  down.splice(down.indexOf(moved), 1)
  down.splice(down.indexOf(next) + 1, 0, moved)
  await expect.poll(() => childIds(canvas, 'n-home-main')).toEqual(down)
  await saved()
  expect(writes()).toBe(1)
  expect(await node(moved).evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  expect(await shown()).toBe('none')

  // And back up by one, then one undo step per drop.
  await node(moved).evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const back = await grabPoint(node(moved))
  const above = (await node(next).boundingBox())!
  await drag(page, back, { x: above.x + above.width / 2, y: above.y + above.height * 0.25 })
  await expect.poll(() => childIds(canvas, 'n-home-main')).toEqual(main)
  await saved()
  await undo()
  await expect.poll(() => childIds(canvas, 'n-home-main')).toEqual(down)
  await undo()
  await expect.poll(() => childIds(canvas, 'n-home-main')).toEqual(main)
  expect(errors).toEqual([])
}, 60_000)

it('reorders cards along a row, and into a card only after resting on it', async () => {
  const { page, canvas, node, shown, label, undo, shot } = await session()
  const cards = await childIds(canvas, 'n-home-feature-list')
  const [first, second, third] = cards as [string, string, string]
  await node(first).evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const from = await grabPoint(node(first))
  const target = (await node(second).boundingBox())!
  const held = await hold(page, from, { x: target.x + target.width * 0.75, y: from.y })
  await expect.poll(shown).toBe('block')
  // The bar stands upright in the gap between the second and third card, filling it.
  const line = await canvas.locator('[data-lacuno-drop-indicator] > div').nth(1).boundingBox()
  const thirdBox = (await node(third).boundingBox())!
  expect(line!.height).toBeGreaterThan(line!.width)
  expect(line!.x).toBeGreaterThan(target.x + target.width - 2)
  expect(line!.x + line!.width).toBeLessThan(thirdBox.x + 2)
  await shot('row')
  await held.release()
  await expect.poll(() => childIds(canvas, 'n-home-feature-list')).toEqual([second, first, third])
  await undo()
  await expect.poll(() => childIds(canvas, 'n-home-feature-list')).toEqual(cards)

  // Resting on the next card settles the drop inside it, with its outline and name.
  const resting = await hold(page, await grabPoint(node(first)), await center(node(second)))
  expect(await label()).toBe('Section')
  await resting.rest(1200)
  await expect.poll(label).toBe('article')
  await shot('rest-into')
  await resting.release(true)
  await expect.poll(() => parentOf(canvas, first)).toBe(second)
  await undo()
  await expect.poll(() => childIds(canvas, 'n-home-feature-list')).toEqual(cards)
}, 60_000)

it('follows wrapped rows in grids and flex-wrap', async () => {
  const { page, canvas, context, origin, siteId, node, document, shot } = await session()
  const style = (cls: string, property: string, value: string) => ({
    type: 'style.set',
    class: cls,
    breakpoint: 'base',
    state: 'none',
    property,
    value: { type: 'raw', value },
  })
  const apply = async (operations: unknown[]) =>
    expect(
      (
        await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
          data: { expectedRevision: (await document()).revision, operations },
        })
      ).status(),
    ).toBe(200)
  await apply([
    { type: 'class.create', id: 'c-wrap', local: true },
    { type: 'class.create', id: 'c-tile', local: true },
    ...Object.entries({ padding: '24px', gap: '16px', width: '520px' }).map(([k, v]) =>
      style('c-wrap', k, v),
    ),
    ...Object.entries({ height: '60px', margin: '0', background: '#ddd' }).map(([k, v]) =>
      style('c-tile', k, v),
    ),
    {
      type: 'node.create',
      parent: 'n-home-main',
      index: 0,
      node: {
        id: 'n-wrap',
        type: 'element',
        tag: 'section',
        classes: ['c-wrap'],
        children: [1, 2, 3, 4].map((i) => ({
          id: `n-tile-${i}`,
          type: 'text',
          tag: 'p',
          classes: ['c-tile'],
          text: { type: 'static', value: `Tile ${i}` },
          children: [],
        })),
      },
    },
  ])
  const tile = (i: number) => node(`n-tile-${i}`)
  for (const mode of ['grid', 'wrap'] as const) {
    await apply([
      style('c-wrap', 'display', mode === 'grid' ? 'grid' : 'flex'),
      style('c-wrap', 'grid-template-columns', 'repeat(2, minmax(0, 1fr))'),
      style('c-wrap', 'flex-wrap', 'wrap'),
      style('c-tile', 'width', mode === 'grid' ? 'auto' : '200px'),
    ])
    await page.reload()
    await tile(1).scrollIntoViewIfNeeded()
    // Tile 4 (second row, right) to the right half of tile 1 (first row, left): between 1 and 2.
    const held = await hold(page, await center(tile(4)), await center(tile(1), 0.8))
    await shot(`wrap-${mode}`)
    await held.release()
    await expect
      .poll(() => childIds(canvas, 'n-wrap'))
      .toEqual(['n-tile-1', 'n-tile-4', 'n-tile-2', 'n-tile-3'])
    // And tile 1 to the left half of tile 3, the start of the second row: after tile 2.
    await drag(page, await center(tile(1)), await center(tile(3), 0.2))
    await expect
      .poll(() => childIds(canvas, 'n-wrap'))
      .toEqual(['n-tile-4', 'n-tile-2', 'n-tile-1', 'n-tile-3'])
    await drag(page, await center(tile(4)), await center(tile(3), 0.8))
    await expect
      .poll(() => childIds(canvas, 'n-wrap'))
      .toEqual(['n-tile-2', 'n-tile-1', 'n-tile-3', 'n-tile-4'])
    await drag(page, await center(tile(1)), await center(tile(2), 0.2))
    await expect
      .poll(() => childIds(canvas, 'n-wrap'))
      .toEqual(['n-tile-1', 'n-tile-2', 'n-tile-3', 'n-tile-4'])
  }
}, 90_000)

it('drops into containers, empty ones at once, and beside a container at its edges', async () => {
  const { page, canvas, node, label, shown, undo, shot, saved, context, origin, siteId, document } =
    await session()
  const title = 'n-home-title'
  await node(title).scrollIntoViewIfNeeded()
  // Into another branch's container: straight away.
  await drag(page, await center(node(title)), await center(node('n-home-hero-note')))
  await expect.poll(() => parentOf(canvas, title)).toBe('n-home-hero-note')
  await saved()
  await undo()
  await expect.poll(() => parentOf(canvas, title)).toBe('n-home-hero-copy')

  // At the note's leading edge: beside it in the hero, not inside it.
  const note = (await node('n-home-hero-note').boundingBox())!
  const edge = await hold(page, await center(node(title)), {
    x: note.x + 4,
    y: note.y + note.height / 2,
  })
  expect(await label()).toBe('Section')
  await shot('edge')
  await edge.release()
  await expect
    .poll(() => childIds(canvas, 'n-home-hero'))
    .toEqual(['n-home-hero-copy', title, 'n-home-hero-note'])
  await saved()
  await undo()
  await expect.poll(() => parentOf(canvas, title)).toBe('n-home-hero-copy')

  // An empty container among the heading's siblings takes it without resting.
  const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: (await document()).revision,
      operations: [
        {
          type: 'node.create',
          parent: 'n-home-hero-copy',
          index: 4,
          node: { id: 'n-empty', type: 'element', tag: 'div', classes: [], children: [] },
        },
      ],
    },
  })
  expect(response.status()).toBe(200)
  await node('n-empty').waitFor({ state: 'attached' })
  await node(title).scrollIntoViewIfNeeded()
  const empty = await hold(page, await center(node(title)), await center(node('n-empty')))
  await expect.poll(shown).toBe('block')
  expect(await label()).toBe('Container')
  await shot('empty')
  await empty.release()
  await expect.poll(() => parentOf(canvas, title)).toBe('n-empty')
}, 60_000)

it('refuses its own insides, text and components, and cancels with Escape', async () => {
  const { page, canvas, node, shown, writes, saved, errors } = await session()
  const title = 'n-home-title'
  // With the hero's copy selected, a press on its heading drags the whole copy block.
  await page.getByRole('button', { name: 'Expand all', exact: true }).click()
  await page.locator('[data-drag-node="n-home-hero-copy"]').click()
  await node(title).scrollIntoViewIfNeeded()
  const own = await hold(page, await center(node(title)), await center(node('n-home-lead')))
  expect(await node('n-home-hero-copy').getAttribute('data-lacuno-dragging')).toBe('')
  await own.rest(1200)
  await own.move(await center(node('n-home-lead'), 0.5, 0.6), 2)
  await own.release()
  await page.waitForTimeout(300)
  expect(writes()).toBe(0)
  expect(await parentOf(canvas, 'n-home-hero-copy')).toBe('n-home-hero')
  expect(await parentOf(canvas, 'n-home-lead')).toBe('n-home-hero-copy')

  // On a paragraph, the heading lands beside it, never inside it.
  await page.locator('[data-drag-node="n-home-kicker"]').click()
  await drag(page, await center(node(title)), await center(node('n-home-lead'), 0.5, 0.8))
  await expect
    .poll(() => childIds(canvas, 'n-home-hero-copy'))
    .toEqual(['n-home-kicker', 'n-home-lead', title, 'n-home-cta'])
  await saved()
  expect(await node('n-home-lead').evaluate((element) => element.children.length)).toBe(0)

  // On the site header, a shared component, it lands beside the header, not in it.
  const header = canvas.locator('[data-lacuno-node="n-home-header"]')
  await header.scrollIntoViewIfNeeded()
  await drag(page, await center(node(title)), await center(header, 0.5, 0.8))
  await expect.poll(() => parentOf(canvas, title)).toBe('n-home-root')
  await saved()

  // Escape ends the drag with nothing written, nothing dimmed and no indicator.
  const before = writes()
  await node(title).scrollIntoViewIfNeeded()
  const cancelled = await hold(page, await center(node(title)), await center(node('n-home-lead')))
  await expect.poll(shown).toBe('block')
  await cancelled.cancel()
  await expect.poll(shown).toBe('none')
  expect(await node(title).getAttribute('data-lacuno-dragging')).toBeNull()
  await page.waitForTimeout(300)
  expect(writes()).toBe(before)
  expect(errors).toEqual([])
}, 60_000)

it('scrolls the canvas near its edge while dragging', async () => {
  const { page, canvas, node } = await session()
  const scrollY = () =>
    node('n-home-root').evaluate((element) => element.ownerDocument.defaultView!.scrollY)
  await node('n-home-title').scrollIntoViewIfNeeded()
  const start = await scrollY()
  const frame = (await page.locator('iframe[title="Site canvas"]').boundingBox())!
  const shell = (await page.locator('.canvas-workspace').boundingBox())!
  const bottom = Math.min(frame.y + frame.height, shell.y + shell.height) - 12
  const held = await hold(page, await center(node('n-home-title')), { x: frame.x + 200, y: bottom })
  await held.rest(600)
  await expect.poll(scrollY).toBeGreaterThan(start + 200)
  await held.cancel()
  expect(await canvas.locator('[data-lacuno-drop-indicator]').isVisible()).toBe(false)
}, 60_000)

it('drops from the Add panel and within the layers, indenting by the pointer', async () => {
  const { page, canvas, node, shot, saved, undo, document } = await session()
  // A new section between the first two, at the hero's bottom edge.
  const main = await childIds(canvas, 'n-home-main')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await node('n-home-hero').evaluate((element) => element.scrollIntoView({ block: 'end' }))
  const hero = (await node('n-home-hero').boundingBox())!
  const tile = await center(page.getByRole('button', { name: 'Section', exact: true }))
  const adding = await hold(page, tile, { x: hero.x + hero.width / 2, y: hero.y + hero.height - 6 })
  await shot('add-section')
  await adding.release()
  await expect
    .poll(async () => (await childIds(canvas, 'n-home-main')).length)
    .toBe(main.length + 1)
  const added = (await childIds(canvas, 'n-home-main'))[1]!
  expect((await document()).nodes[added]).toMatchObject({ tag: 'section' })
  await saved()
  await undo()
  await expect.poll(() => childIds(canvas, 'n-home-main')).toEqual(main)

  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await page.getByRole('button', { name: 'Expand all', exact: true }).click()
  const row = (id: string) => page.locator(`[data-drag-node="${id}"]`)
  // Between two rows, at the dragged row's depth: after the paragraph.
  const lead = (await row('n-home-lead').boundingBox())!
  const from = await center(row('n-home-title'))
  const between = await hold(page, from, { x: from.x, y: lead.y + lead.height - 2 })
  await shot('layers-between')
  await between.release()
  await expect
    .poll(() => childIds(canvas, 'n-home-hero-copy'))
    .toEqual(['n-home-kicker', 'n-home-lead', 'n-home-title', 'n-home-cta'])
  await saved()
  await undo()
  // Onto the middle of a container's row: into it.
  await expect
    .poll(() => childIds(canvas, 'n-home-hero-copy'))
    .toEqual(['n-home-kicker', 'n-home-title', 'n-home-lead', 'n-home-cta'])
  const into = await hold(
    page,
    await center(row('n-home-title')),
    await center(row('n-home-hero-note')),
  )
  await shot('layers-into')
  await into.release()
  await expect.poll(() => parentOf(canvas, 'n-home-title')).toBe('n-home-hero-note')
  await saved()
  await undo()
  await expect.poll(() => parentOf(canvas, 'n-home-title')).toBe('n-home-hero-copy')
  // Below the note's last child and two steps to the left: out to the main, after the hero.
  const last = await center(row('n-home-note-copy'))
  const box = (await row('n-home-note-copy').boundingBox())!
  const out = await hold(page, last, { x: last.x - 28, y: box.y + box.height - 2 })
  await shot('layers-outdent')
  await out.release()
  await expect
    .poll(async () => (await childIds(canvas, 'n-home-main')).slice(0, 2))
    .toEqual(['n-home-hero', 'n-home-note-copy'])
}, 60_000)

it('moves the selection with Alt and the arrow keys, one undo step each', async () => {
  const { page, canvas, node, saved, undo } = await session()
  const main = await childIds(canvas, 'n-home-main')
  const moved = main[1]!
  await node(moved).scrollIntoViewIfNeeded()
  await page.mouse.click(...(Object.values(await grabPoint(node(moved))) as [number, number]))
  await expect.poll(() => node(moved).getAttribute('data-lacuno-selected')).toBe('')
  await page.keyboard.press('Alt+ArrowDown')
  const down = [main[0]!, main[2]!, moved, ...main.slice(3)]
  await expect.poll(() => childIds(canvas, 'n-home-main')).toEqual(down)
  await saved()
  await page.locator(`[data-drag-node="${moved}"]`).focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(() => childIds(canvas, 'n-home-main')).toEqual(main)
  await saved()
  await undo()
  await expect.poll(() => childIds(canvas, 'n-home-main')).toEqual(down)
}, 60_000)

it('keeps the line at least two screen pixels thick at any canvas zoom, the gap where there is one', async () => {
  const { page, node, indicator, shown } = await session({ width: 1200, height: 1000 })
  const frame = page.locator('iframe[title="Site canvas"]')
  for (const preset of ['Desktop', 'Tablet']) {
    await page.getByRole('button', { name: preset, exact: true }).click()
    await node('n-home-title').scrollIntoViewIfNeeded()
    const lead = (await node('n-home-lead').boundingBox())!
    const held = await hold(page, await center(node('n-home-title')), {
      x: lead.x + lead.width / 2,
      y: lead.y + lead.height * 0.8,
    })
    await expect.poll(shown).toBe('block')
    const zoom = await frame.evaluate(
      (element) => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth,
    )
    const gap = await node('n-home-hero-copy').evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).rowGap) || 0,
    )
    const height = (await indicator.locator('div').nth(1).boundingBox())!.height
    expect(height).toBeGreaterThanOrEqual(1.5)
    expect(height).toBeCloseTo(Math.max(2, gap * zoom), 0)
    await held.cancel()
  }
}, 60_000)

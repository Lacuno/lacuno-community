import path from 'node:path'
import { expect, it } from 'vitest'
import { editor, root } from './harness.js'

it('projects vertical, grid, wrapped, reversed and nested drops without writes until one undoable commit', async () => {
  const { context, page, canvas, origin, siteId } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let writes = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/document/apply')) writes++
  })
  const projection = page.frameLocator('iframe[title="Drag preview"]')
  const projectedLead = projection.locator('[data-miralo-node="n-home-lead"]')
  const heading = canvas.locator('[data-miralo-node="n-home-title"]')
  const lead = canvas.locator('[data-miralo-node="n-home-lead"]')
  const parent = canvas.locator('[data-miralo-node="n-home-hero-copy"]')
  const gap = canvas.locator('[data-miralo-sort-gap]')
  const order = () =>
    parent.evaluate((element) =>
      Array.from(element.children, (child) => child.getAttribute('data-miralo-node')),
    )
  const styles = () =>
    parent.evaluate((element) =>
      Array.from(element.children, (child) => child.getAttribute('style') || ''),
    )
  await heading.click()
  const originalOrder = await order()
  const originalStyles = await styles()
  const snapshot = () =>
    context.request.get(`${origin}/api/sites/${siteId}/document`).then((r) => r.json())
  const before = await snapshot()
  const cdp = await context.newCDPSession(page)
  const move = (x: number, y: number) =>
    cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'left',
      buttons: 1,
    })
  const begin = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...from,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    for (let step = 1; step <= 20; step++)
      await move(from.x + ((to.x - from.x) * step) / 20, from.y + ((to.y - from.y) * step) / 20)
    await move(to.x, to.y)
    await move(to.x, to.y)
    await expect.poll(() => gap.count()).toBe(1)
  }
  const release = (point: { x: number; y: number }) =>
    cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
  const start = async () => {
    await heading.scrollIntoViewIfNeeded()
    const source = (await heading.boundingBox())!
    const target = (await lead.boundingBox())!
    const x = source.x + 80
    const y = target.y + target.height * 0.8
    await begin({ x, y: source.y + source.height * 0.5 }, { x, y })
    return { x, y, target }
  }
  const point = await start()
  await expect.poll(() => gap.getAttribute('data-destination')).toBe('n-home-lead')
  await expect
    .poll(async () => (await projectedLead.boundingBox())!.y)
    .toBeLessThan(point.target.y - 20)
  expect((await lead.boundingBox())!.y).toBe(point.target.y)
  expect(await order()).toEqual(originalOrder)
  expect(
    await projection
      .locator('[data-miralo-node="n-home-title"]')
      .evaluate((element) => getComputedStyle(element).opacity),
  ).toBe('0')
  expect(
    await canvas
      .locator('[data-miralo-drop-indicator]')
      .evaluate((element) => getComputedStyle(element).display),
  ).toBe('none')
  for (let i = 0; i < 5; i++) await move(point.x, point.y)
  expect(await gap.getAttribute('data-destination')).toBe('n-home-lead')
  expect(writes).toBe(0)
  expect((await snapshot()).revision).toBe(before.revision)
  await page.screenshot({ path: path.join(root, '.miralo/editor-preview/drag-sort-gap.png') })
  await heading.evaluate((element) => element.ownerDocument.defaultView!.scrollBy(0, 40))
  await expect
    .poll(
      async () =>
        (await projectedLead.evaluate((element) => element.ownerDocument.defaultView!.scrollY)) -
        (await lead.evaluate((element) => element.ownerDocument.defaultView!.scrollY)),
    )
    .toBe(0)
  await page.setViewportSize({ width: 1400, height: 1000 })
  await expect
    .poll(
      async () =>
        (await page.locator('iframe[title="Drag preview"]').boundingBox())!.width -
        (await page.locator('iframe[title="Site canvas"]').boundingBox())!.width,
    )
    .toBeCloseTo(0, 2)
  await cdp.send('Input.cancelDragging')
  await page.keyboard.press('Escape')
  await expect.poll(() => gap.count()).toBe(0)
  expect(await styles()).toEqual(originalStyles)
  expect(await order()).toEqual(originalOrder)
  expect(writes).toBe(0)
  await page.setViewportSize({ width: 1500, height: 1000 })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const drop = await start()
  expect(await projectedLead.evaluate((element) => element.getAnimations().length)).toBe(0)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: drop.x,
    y: drop.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await expect
    .poll(() => order())
    .toEqual(['n-home-kicker', 'n-home-lead', 'n-home-title', 'n-home-cta'])
  await expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
  expect(writes).toBe(1)
  expect((await snapshot()).revision).toBe(before.revision + 1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => order()).toEqual(originalOrder)
  expect(await styles()).toEqual(originalStyles)

  // The uneven columns from the real template resize/reflow in the projection only.
  const aside = canvas.locator('[data-miralo-node="n-home-hero-note"]')
  const hero = canvas.locator('[data-miralo-node="n-home-hero"]')
  const heroOrder = () =>
    hero.evaluate((element) =>
      Array.from(element.children, (child) => child.getAttribute('data-miralo-node')),
    )
  const oldHeroOrder = await heroOrder()
  const fromAside = (await aside.boundingBox())!
  const copyBox = (await parent.boundingBox())!
  const swapPoint = { x: copyBox.x + 3, y: copyBox.y + 20 }
  const gridRevision = (await snapshot()).revision
  await begin({ x: fromAside.x + 3, y: fromAside.y + 3 }, swapPoint)
  await expect.poll(() => gap.getAttribute('data-parent')).toBe('n-home-hero')
  expect(await gap.getAttribute('data-index')).toBe('0')
  const resized = (await projection.locator('[data-miralo-node="n-home-hero-copy"]').boundingBox())!
  expect(resized.width).toBeLessThan(copyBox.width / 2)
  expect(resized.height).toBeGreaterThan(copyBox.height)
  expect(await heroOrder()).toEqual(oldHeroOrder)
  expect((await parent.boundingBox())!.width).toBe(copyBox.width)
  for (let i = 0; i < 5; i++) await move(swapPoint.x, swapPoint.y)
  expect(await gap.getAttribute('data-index')).toBe('0')
  expect((await snapshot()).revision).toBe(gridRevision)
  await page.screenshot({ path: path.join(root, '.miralo/editor-preview/drag-grid-gap.png') })
  await release(swapPoint)
  await expect.poll(() => heroOrder()).toEqual([...oldHeroOrder].reverse())
  expect((await parent.boundingBox())!.width).toBeCloseTo(resized.width, 0)
  expect((await parent.boundingBox())!.height).toBeCloseTo(resized.height, 0)
  expect((await snapshot()).revision).toBe(gridRevision + 1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => heroOrder()).toEqual(oldHeroOrder)

  // Reparenting opens a gap in the new container and closes the old one.
  await heading.scrollIntoViewIfNeeded()
  const note = canvas.locator('[data-miralo-node="n-home-note-copy"]')
  const noteBox = (await note.boundingBox())!
  const headingBox = (await heading.boundingBox())!
  const nestedPoint = { x: noteBox.x + noteBox.width / 2, y: noteBox.y + noteBox.height * 0.8 }
  await begin({ x: headingBox.x + 50, y: headingBox.y + 20 }, nestedPoint)
  await expect.poll(() => gap.getAttribute('data-parent')).toBe('n-home-hero-note')
  expect(
    await projection
      .locator('[data-miralo-node="n-home-title"]')
      .evaluate((element) => element.parentElement!.getAttribute('data-miralo-node')),
  ).toBe('n-home-hero-note')
  expect(
    await heading.evaluate((element) => element.parentElement!.getAttribute('data-miralo-node')),
  ).toBe('n-home-hero-copy')
  await release(nestedPoint)
  await expect
    .poll(() =>
      heading.evaluate((element) => element.parentElement!.getAttribute('data-miralo-node')),
    )
    .toBe('n-home-hero-note')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => order()).toEqual(originalOrder)

  // Compact fixtures exercise row wrapping, multi-row grids, reverse flow and RTL.
  const fixtureRevision = (await snapshot()).revision
  const styleOperation = (cls: string, property: string, value: string) => ({
    type: 'style.set',
    class: cls,
    breakpoint: 'base',
    state: 'none',
    property,
    value: { type: 'raw', value },
  })
  const fixture = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: fixtureRevision,
      operations: [
        { type: 'class.create', id: 'c-drag-layout', local: true },
        { type: 'class.create', id: 'c-drag-card', local: true },
        ...Object.entries({
          width: '480px',
          'max-width': '100%',
          padding: '24px',
          gap: '16px',
          'box-sizing': 'border-box',
        }).map(([key, value]) => styleOperation('c-drag-layout', key, value)),
        ...Object.entries({
          height: '60px',
          margin: '0',
          'flex-shrink': '0',
          background: '#ddd',
        }).map(([key, value]) => styleOperation('c-drag-card', key, value)),
        {
          type: 'node.create',
          parent: 'n-home-main',
          index: 0,
          node: {
            id: 'n-drag-layout',
            type: 'element',
            tag: 'section',
            classes: ['c-drag-layout'],
            children: [1, 2, 3].map((i) => ({
              id: `n-drag-card-${i}`,
              type: 'text',
              tag: 'p',
              classes: ['c-drag-card'],
              text: { type: 'static', value: `Card ${i}` },
              children: [],
            })),
          },
        },
      ],
    },
  })
  expect(fixture.status()).toBe(200)
  for (const mode of ['grid', 'wrap', 'reverse', 'rtl'] as const) {
    const revision = (await snapshot()).revision
    const changed = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
      data: {
        expectedRevision: revision,
        operations: [
          ...Object.entries({
            display: mode === 'grid' ? 'grid' : 'flex',
            'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
            'flex-direction': mode === 'reverse' ? 'row-reverse' : 'row',
            'flex-wrap': mode === 'wrap' ? 'wrap' : 'nowrap',
            direction: mode === 'rtl' ? 'rtl' : 'ltr',
          }).map(([key, value]) => styleOperation('c-drag-layout', key, value)),
          styleOperation(
            'c-drag-card',
            'width',
            mode === 'grid' ? 'auto' : mode === 'wrap' ? '180px' : '120px',
          ),
        ],
      },
    })
    expect(changed.status()).toBe(200)
    await page.reload()
    const card = (i: number) => canvas.locator(`[data-miralo-node="n-drag-card-${i}"]`)
    await card(1).scrollIntoViewIfNeeded()
    const first = (await card(1).boundingBox())!
    const third = (await card(3).boundingBox())!
    const target = {
      x: mode === 'reverse' || mode === 'rtl' ? first.x + first.width - 3 : first.x + 3,
      y: first.y + first.height / 2,
    }
    await begin({ x: third.x + third.width / 2, y: third.y + third.height / 2 }, target)
    await expect.poll(() => gap.getAttribute('data-parent')).toBe('n-drag-layout')
    expect(await gap.getAttribute('data-index')).toBe('0')
    const finalBox = (await projection.locator('[data-miralo-node="n-drag-card-1"]').boundingBox())!
    expect(await card(1).boundingBox()).toEqual(first)
    const layoutOrder = () =>
      canvas
        .locator('[data-miralo-node="n-drag-layout"]')
        .evaluate((element) =>
          Array.from(element.children, (child) => child.getAttribute('data-miralo-node')),
        )
    expect(await layoutOrder()).toEqual(['n-drag-card-1', 'n-drag-card-2', 'n-drag-card-3'])
    await release(target)
    await expect
      .poll(() => layoutOrder())
      .toEqual(['n-drag-card-3', 'n-drag-card-1', 'n-drag-card-2'])
    const actual = (await card(1).boundingBox())!
    expect(actual.x).toBeCloseTo(finalBox.x, 0)
    expect(actual.y).toBeCloseTo(finalBox.y, 0)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect
      .poll(() => layoutOrder())
      .toEqual(['n-drag-card-1', 'n-drag-card-2', 'n-drag-card-3'])
  }

  // Palette presets get a real-sized gap, using exactly the insertion's default styles.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const paletteRevision = (await snapshot()).revision
  for (const name of ['Section', 'Image', 'Grid']) {
    const tile = (await page.getByRole('button', { name, exact: true }).boundingBox())!
    const card = (await canvas.locator('[data-miralo-node="n-drag-card-1"]').boundingBox())!
    const destination = { x: card.x + 3, y: card.y + card.height / 2 }
    await begin({ x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 }, destination)
    const insertedId = await gap.getAttribute('data-source')
    const inserted = projection.locator(`[data-miralo-node="${insertedId}"]`)
    expect((await inserted.boundingBox())!.height).toBeGreaterThan(0)
    expect(await inserted.evaluate((element) => getComputedStyle(element).opacity)).toBe('0')
    if (name === 'Section') expect(await inserted.locator('h2').textContent()).toBe('A new section')
    if (name === 'Image')
      expect(await inserted.getAttribute('data-miralo-image-placeholder')).toBe('')
    if (name === 'Grid')
      expect(await inserted.evaluate((element) => getComputedStyle(element).display)).toBe('grid')
    expect((await snapshot()).revision).toBe(paletteRevision)
    await cdp.send('Input.cancelDragging')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('iframe[title="Drag preview"]').count()).toBe(0)
  }
  await page.getByRole('button', { name: 'Layers', exact: true }).click()

  const beforeFailure = await snapshot()
  await page.route('**/document/apply', (route) =>
    route.fulfill({ status: 500, json: { error: 'Simulated save failure' } }),
  )
  const failedDrop = await start()
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: failedDrop.x,
    y: failedDrop.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await page.getByText('Simulated save failure', { exact: true }).waitFor()
  await expect.poll(() => gap.count()).toBe(0)
  expect(await order()).toEqual(originalOrder)
  expect(await styles()).toEqual(originalStyles)
  expect((await snapshot()).revision).toBe(beforeFailure.revision)
  expect(errors).toEqual([])
}, 40000)

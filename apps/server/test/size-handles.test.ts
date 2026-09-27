import { expect, it } from 'vitest'
import { drag, editor, openFormatting } from './harness.js'

it('drags on-canvas size handles: 1:1 width, one-step corner, Shift ratio, clears max caps and flex shrink', async () => {
  const { page, canvas, document, saved } = await editor({ width: 1200, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let writes = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/document/apply')) writes++
  })
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()

  // Iframe transform scale: the pointer maps to CSS px through it, so a screen drag of d moves
  // the edge d/zoom CSS px (the handle math uses the iframe's own coordinates, no division).
  const zoom = await page
    .locator('iframe[title="Site canvas"]')
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
  expect(zoom).toBeLessThan(1)

  // Read the rendered border box and the written sizes in one snapshot, never mid-commit.
  const size = () =>
    cta.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return { w: box.width, h: box.height, width: style.width, height: style.height }
    })
  const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click()

  // The right handle sets width only; the rendered box follows the pointer 1:1 in CSS px.
  const start = await size()
  let before = writes
  await drag(page, '.handle.size.right', { dx: 60 })
  await saved()
  await expect.poll(async () => (await size()).w).toBeGreaterThan(start.w + 30)
  const wide = await size()
  expect(wide.w - start.w).toBeCloseTo(60 / zoom, 0)
  expect(wide.h).toBeCloseTo(start.h, 0)
  expect(writes).toBe(before + 1)

  // The corner sets width and height in one write, and one Undo restores both.
  before = writes
  await drag(page, '.handle.size.corner', { dx: 40, dy: 30 })
  await saved()
  await expect.poll(async () => (await size()).h).toBeGreaterThan(wide.h + 20)
  const corner = await size()
  expect(corner.w - wide.w).toBeCloseTo(40 / zoom, 0)
  expect(corner.h - wide.h).toBeCloseTo(30 / zoom, 0)
  expect(writes).toBe(before + 1)
  await undo()
  await saved()
  await expect.poll(async () => (await size()).h).toBeLessThan(wide.h + 1)
  const undone = await size()
  expect(undone.w).toBeCloseTo(wide.w, 0)
  expect(undone.h).toBeCloseTo(wide.h, 0)

  // Shift on the corner keeps the aspect ratio: the larger relative change leads.
  await drag(page, '.handle.size.corner', { dx: 80, dy: 5 }, 8)
  await saved()
  await expect.poll(async () => (await size()).w).toBeGreaterThan(undone.w + 40)
  const kept = await size()
  expect(kept.h / kept.w / (undone.h / undone.w)).toBeCloseTo(1, 1)
  expect(kept.h).toBeGreaterThan(undone.h + 5)

  // Adds a site rule to the canvas (PARENT names the CTA's parent), then waits two frames so the
  // overlay has moved the handles to the new box before the next drag reads their position.
  const inject = async (css: string) => {
    await cta.evaluate((element, text) => {
      const style = element.ownerDocument.createElement('style')
      style.textContent = text.replace('PARENT', element.parentElement!.dataset.lacunoNode!)
      element.ownerDocument.head.append(style)
    }, css)
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  }

  // Under content-box the written width leaves out padding and border, so the rendered box
  // still follows the pointer 1:1.
  await inject('[data-lacuno-node="n-home-cta"] { box-sizing: content-box !important }')
  const content = await size()
  await drag(page, '.handle.size.right', { dx: 60 })
  await saved()
  await expect.poll(async () => (await size()).w).toBeGreaterThan(content.w + 30)
  expect((await size()).w - content.w).toBeCloseTo(60 / zoom, 0)

  // The committed declarations of the CTA's classes, from the saved document.
  const committed = async (id = 'n-home-cta') => {
    const doc = await document()
    return Object.values(doc.styles).filter((style) => doc.nodes[id]!.classes.includes(style.class))
  }

  // A max-width cap is cleared by the same drag once the width passes it, in the same commit, and
  // one Undo restores both. The cap has no specificity, like any site rule the local class beats.
  const uncapped = await size()
  await inject(
    `:where([data-lacuno-node="n-home-cta"]) { max-width: ${Math.round(uncapped.w) + 20}px }`,
  )
  const capped = await size()
  expect(capped.w).toBeCloseTo(uncapped.w, 0)
  const beforeCap = await committed()
  before = writes
  await drag(page, '.handle.size.right', { dx: 120 })
  await saved()
  await expect.poll(async () => (await size()).w).toBeGreaterThan(capped.w + 60)
  expect(Math.abs((await size()).w - capped.w - 120 / zoom)).toBeLessThan(1)
  expect(await committed()).toContainEqual(
    expect.objectContaining({ property: 'max-width', value: { type: 'keyword', value: 'none' } }),
  )
  expect(writes).toBe(before + 1)
  await undo()
  await saved()
  await expect.poll(() => committed()).toEqual(beforeCap)
  await expect.poll(async () => (await size()).w).toBeCloseTo(capped.w, 0)

  // In a flex row the element would shrink back into the free space, so a width drag also stops
  // it shrinking: the rendered width follows the pointer and the commit carries flex-shrink: 0.
  await inject(
    '[data-lacuno-node="PARENT"] { display: flex !important; flex-direction: row !important }',
  )
  const row = await cta.evaluate((element) => ({
    shrink: getComputedStyle(element).flexShrink,
    w: element.getBoundingClientRect().width,
  }))
  expect(row.shrink).not.toBe('0')
  await drag(page, '.handle.size.right', { dx: 160 })
  await saved()
  await expect.poll(async () => (await size()).w).toBeGreaterThan(row.w + 100)
  expect(Math.abs((await size()).w - row.w - 160 / zoom)).toBeLessThan(1)
  expect(await committed()).toContainEqual(
    expect.objectContaining({
      property: 'flex-shrink',
      value: { type: 'unit', value: 0, unit: 'number' },
    }),
  )

  // A drag out and back still ends the drag, so the panel's autosave is not left switched off.
  await drag(page, '.handle.size.right', { dx: 40 }, 0, true)
  await openFormatting(page, 'Layout')
  const applied = page.waitForResponse(
    (response) =>
      response.url().endsWith('/document/apply') &&
      !!response.request().postData()?.includes('padding-top'),
  )
  await page.locator('aside.inspector').getByLabel('Inside spacing top', { exact: true }).fill('30')
  await applied

  // A percentage cap, like the image preset's max-width: 100%, is not a px cap to clear.
  const image = canvas.locator('[data-lacuno-node="n-home-preview-image"]')
  await image.click()
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.complete))
    .toBe(true)
  await inject(':where([data-lacuno-node="n-home-preview-image"]) { max-width: 100% }')
  await drag(page, '.handle.size.right', { dx: -60 })
  await expect
    .poll(async () => (await committed('n-home-preview-image')).map((style) => style.property))
    .toContain('width')
  expect((await committed('n-home-preview-image')).map((style) => style.property)).not.toContain(
    'max-width',
  )

  expect(errors).toEqual([])
}, 60000)

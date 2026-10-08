import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('shows the state chip and colour wheel on the canvas selection bar', async () => {
  const { context, page, canvas, document } = await editor()
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()
  // The bars carry the state chip and, for a text node, both a text and a background swatch.
  await expect.poll(() => canvas.getByRole('button', { name: /^State: / }).count()).toBe(1)
  await expect.poll(() => canvas.getByRole('button', { name: /^Text color: / }).count()).toBe(1)
  await expect
    .poll(() => canvas.getByRole('button', { name: /^Background color: / }).count())
    .toBe(1)
  // Opening the swatch reveals the wheel, the project colours and the save field.
  await canvas.getByRole('button', { name: /^Text color: / }).click()
  await expect.poll(() => canvas.locator('.wheel').count()).toBe(1)
  await expect.poll(() => canvas.getByLabel('Project color name').count()).toBe(1)
  // Every colour gesture commits as it ends, with the wheel still open.
  const applied = (property: string) =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/document/apply') &&
        !!response.request().postData()?.includes(property),
    )
  // The template ships project colours; picking one binds the element.
  const dots = canvas.locator('.swatches button')
  await expect.poll(() => dots.count()).toBeGreaterThan(0)
  const before = await cta.evaluate((element) => getComputedStyle(element).color)
  const color = applied('"color"')
  await dots.first().click()
  await color
  await expect
    .poll(() => cta.evaluate((element) => getComputedStyle(element).color))
    .not.toBe(before)

  // A wheel drag commits on release, so switching state straight after keeps the colour.
  await canvas.getByRole('button', { name: /^Background color: / }).click()
  const wheel = (await canvas.locator('.wheel').boundingBox())!
  const background = applied('background-color')
  // Raw input events: Playwright's mouse.move never resolves under the wheel's pointer capture.
  const cdp = await context.newCDPSession(page)
  const mouse = (
    type: 'mousePressed' | 'mouseMoved' | 'mouseReleased',
    x: number,
    y: number,
    buttons = 1,
  ) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      x: wheel.x + wheel.width * x,
      y: wheel.y + wheel.height * y,
      button: 'left',
      buttons,
      clickCount: 1,
    })
  await mouse('mousePressed', 0.2, 0.5)
  for (const step of [0.25, 0.3, 0.35]) await mouse('mouseMoved', step, step)
  await mouse('mouseReleased', 0.35, 0.35, 0)
  await background
  // The open wheel covers the chip here, so the click goes to the chip itself.
  await canvas.getByRole('button', { name: /^State: / }).dispatchEvent('click')
  await canvas.getByRole('menuitemradio', { name: /^Hover/ }).click()
  await expect.poll(() => canvas.getByRole('button', { name: 'State: Hover' }).count()).toBe(1)
  // Switching resets the label to "Saved"; a save landing after the switch reads "All changes saved".
  await expect
    .poll(() => page.locator('.save-state').textContent())
    .toMatch(/^(All changes saved|Saved)$/)
  // A picked colour saves as a project colour that the element binds to.
  await canvas.getByRole('button', { name: /^Background color: / }).click()
  await mouse('mousePressed', 0.7, 0.3)
  await mouse('mouseReleased', 0.7, 0.3, 0)
  await canvas.getByLabel('Project color name').fill('Sky')
  await canvas.getByRole('button', { name: 'Save', exact: true }).click()
  const bound = async () => {
    const saved = await document()
    const token = Object.values(saved.designTokens).find((item) => item.name === 'color.sky')
    return Object.values(saved.styles).some(
      (style) =>
        saved.nodes['n-home-cta']!.classes.includes(style.class) &&
        style.property === 'background-color' &&
        JSON.stringify(style.value) === JSON.stringify({ type: 'designToken', ref: token?.id }),
    )
  }
  await expect.poll(bound).toBe(true)
}, 60000)

it("outlines the hovered node's parent and siblings, with an arrow along the flow", async () => {
  const { page, canvas } = await editor({ width: 1200, height: 1000 })
  const title = canvas.locator('[data-lacuno-node="n-home-title"]')
  await title.waitFor()
  const box = (await title.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const parent = canvas.locator('.hover .parent')
  await expect.poll(() => parent.count()).toBe(1)
  // The parent's rectangle is the copy block; the other three children are faint siblings.
  const copy = (await canvas.locator('[data-lacuno-node="n-home-hero-copy"]').boundingBox())!
  const outlined = (await parent.boundingBox())!
  // Within the stroke the rectangle's box includes.
  expect(Math.abs(outlined.x - copy.x)).toBeLessThan(2)
  expect(Math.abs(outlined.width - copy.width)).toBeLessThan(2)
  expect(await canvas.locator('.hover .sibling').count()).toBe(3)
  expect(await canvas.locator('.hover .arrow').count()).toBe(1)
  // Leaving the page clears them.
  await page.mouse.move(5, 5)
  await expect.poll(() => parent.count()).toBe(0)
}, 60_000)

it('keeps the selection bar inside the Mobile canvas, with the Align chip in reach', async () => {
  const { page, canvas, context, origin, siteId, document } = await editor({
    width: 1200,
    height: 1000,
  })
  // A long label on an element with room to align (the image fills the phone's width, so it
  // offers no Align chip there): the name gives way to the chips, which stay in view.
  const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: (await document()).revision,
      operations: [
        { type: 'node.update', id: 'n-home-cta', meta: { label: 'Rendered About page preview' } },
      ],
    },
  })
  expect(response.status()).toBe(200)
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect
    .poll(() => page.locator('iframe[title="Site canvas"]').evaluate((el) => el.clientWidth))
    .toBe(390)
  await cta.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await cta.dispatchEvent('click')
  const chip = canvas.getByRole('button', { name: 'Align', exact: true })
  await chip.waitFor()
  await expect
    .poll(() => canvas.locator('.bar-top .name').textContent())
    .toBe('Rendered About page preview')
  const frame = (await page.locator('iframe[title="Site canvas"]').boundingBox())!
  const bar = (await canvas.locator('.bar-top').boundingBox())!
  const align = (await chip.boundingBox())!
  expect(bar.x + bar.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5)
  expect(align.x + align.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5)
  await chip.click()
  await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('true')
}, 60_000)

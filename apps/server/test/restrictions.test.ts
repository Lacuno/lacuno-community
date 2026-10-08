import { expect, it } from 'vitest'
import { drag, editor, openFormatting, press } from './harness.js'

it('hides the handles and chips of a locked element and says Locked in the bar; a conflict reads View only', async () => {
  const { context, origin, page, canvas, siteId, document } = await editor({
    width: 1200,
    height: 1000,
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()
  const shown = (selector: string) =>
    canvas.locator(selector).evaluate((element) => element.checkVisibility())
  const field = () => canvas.locator('.bar-top .field').textContent()
  await expect.poll(() => shown('.handle.size.right')).toBe(true)

  // An agent locks the hero from outside; the edit streams in and the CTA inherits the lock.
  const lock = async (locked: boolean) => {
    const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
      data: {
        expectedRevision: (await document()).revision,
        operations: [{ type: 'node.update', id: 'n-home-hero', meta: { locked } }],
      },
    })
    expect(response.status()).toBe(200)
  }
  await lock(true)
  await expect.poll(field).toBe('Locked')
  expect(await shown('.handle.size.right')).toBe(false)
  for (const name of ['Spacing', 'Align'])
    expect(await canvas.getByRole('button', { name, exact: true }).count()).toBe(0)
  expect(await canvas.getByRole('button', { name: /^Background color: / }).count()).toBe(0)
  // The state chip stays: it only chooses what the sidebar shows.
  expect(await canvas.getByRole('button', { name: /^State: / }).count()).toBe(1)
  await lock(false)
  await expect.poll(() => shown('.handle.size.right')).toBe(true)
  expect(await field()).toBe('')
  expect(await canvas.getByRole('button', { name: 'Align', exact: true }).count()).toBe(1)

  // A conflict (an outside edit while a draft is unsaved) makes the canvas view only until the
  // reload, and closes the Align controls.
  await canvas.getByRole('button', { name: 'Align', exact: true }).click()
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  await expect.poll(() => menu.isVisible()).toBe(true)
  await page.getByLabel('Text', { exact: true }).fill('Unsaved draft')
  const concurrent = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: (await document()).revision,
      operations: [{ type: 'site.update', name: 'Updated elsewhere' }],
    },
  })
  expect(concurrent.status()).toBe(200)
  await page.getByRole('button', { name: 'Reload latest', exact: true }).waitFor()
  await expect.poll(field).toBe('View only')
  expect(await shown('.handle.size.right')).toBe(false)
  expect(await menu.isVisible()).toBe(false)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Reload latest', exact: true }).click()
  await expect.poll(field).toBe('')
  await expect.poll(() => shown('.handle.size.right')).toBe(true)
  expect(errors).toEqual([])
}, 60_000)

it('reads "limited" while a size drag asks for more than the box follows', async () => {
  const { page, canvas, saved } = await editor({ width: 1200, height: 1000 })
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  const tag = canvas.locator('.tag')
  const limited = () => tag.evaluate((element) => element.classList.contains('limited'))
  // The image preset's max-width: 100% holds the image where it is, whatever the drag asks.
  const image = canvas.locator('[data-lacuno-node="n-home-preview-image"]')
  await image.click()
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.complete))
    .toBe(true)
  await image.evaluate((element) => {
    const style = element.ownerDocument.createElement('style')
    style.textContent = ':where([data-lacuno-node="n-home-preview-image"]) { max-width: 100% }'
    element.ownerDocument.head.append(style)
  })
  const width = () => image.evaluate((element) => element.getBoundingClientRect().width)
  const before = await width()
  let release = await press(page, '.handle.size.right', { dx: 80 })
  await expect.poll(() => tag.textContent()).toMatch(/px$/)
  await expect.poll(limited).toBe(true)
  await release()
  await saved()
  expect(await width()).toBeCloseTo(before, 0)

  // A box that follows the pointer never says so.
  await cta.click()
  release = await press(page, '.handle.size.right', { dx: 60 })
  await expect.poll(() => tag.textContent()).toMatch(/px$/)
  await page.waitForTimeout(200)
  expect(await limited()).toBe(false)
  await release()
  await saved()
}, 60_000)

it('commits a handle drag while a class name is being typed', async () => {
  const { page, canvas } = await editor({ width: 1200, height: 1000 })
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()
  await page.getByText('Advanced: shared classes', { exact: true }).click()
  await page.getByText('Assign or create class', { exact: true }).click()
  await page.getByLabel('New class name', { exact: true }).fill('hero-button')
  const start = await cta.evaluate((element) => element.getBoundingClientRect().width)
  const applied = page.waitForResponse((response) => response.url().endsWith('/document/apply'))
  await drag(page, '.handle.size.right', { dx: 60 })
  await applied
  await expect
    .poll(() => cta.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(start + 30)
  // The draft is still hers to finish.
  expect(await page.getByLabel('New class name', { exact: true }).inputValue()).toBe('hero-button')
}, 60_000)

it('writes nothing for Distribute on a distributed parent or Fill on a filled child', async () => {
  const { page, canvas, saved } = await editor({ width: 1200, height: 1000 })
  let writes = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/document/apply')) writes++
  })
  // The hero note is a Row with justify-content: space-between already.
  const copy = canvas.locator('[data-lacuno-node="n-home-note-copy"]')
  await copy.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await copy.dispatchEvent('click')
  await canvas.getByRole('button', { name: 'Align', exact: true }).click()
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  let before = writes
  await menu.getByRole('button', { name: 'Distribute siblings' }).click()
  await page.waitForTimeout(800)
  expect(writes).toBe(before)
  expect(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled()).toBe(true)

  // Fill once writes; Fill again on the filled child does not.
  await page.keyboard.press('Escape')
  await openFormatting(page, 'Layout')
  const fill = page.getByRole('button', { name: 'Width: Fill space', exact: true })
  await fill.click()
  await saved()
  await expect.poll(() => fill.getAttribute('aria-pressed')).toBe('true')
  before = writes
  await fill.click()
  await page.waitForTimeout(800)
  expect(writes).toBe(before)
}, 60_000)

it('names the value a token snap replaced, and makes an inline element inline-block when sized', async () => {
  const { page, canvas, saved, document } = await editor({ width: 1200, height: 1000 })
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()
  await canvas.getByRole('button', { name: 'Spacing', exact: true }).click()
  const zoom = await page
    .locator('iframe[title="Site canvas"]')
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
  const top = await cta.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).paddingTop),
  )
  // Aim 2 px past the 24 px token: the readout names the token and the value it stands in for.
  let release = await press(page, '.handle.padding.top', { dy: -(26 - top) * zoom })
  const tag = canvas.locator('.tag')
  await expect.poll(() => tag.textContent()).toMatch(/^space\.\w+ · (⌘|Ctrl) for 2[5-7]px$/)
  await release(true)
  await canvas.getByRole('button', { name: 'Spacing', exact: true }).click()

  // A span from the palette is inline, so width, height and vertical margins would be ignored:
  // the drag makes it inline-block in the same commit.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Span', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await saved()
  const span = canvas.locator('span[data-lacuno-node]', { hasText: 'Span' })
  await span.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await span.dispatchEvent('click')
  await expect.poll(() => span.getAttribute('data-lacuno-selected')).toBe('')
  expect(await span.evaluate((element) => getComputedStyle(element).display)).toBe('inline')
  const id = (await span.getAttribute('data-lacuno-node'))!
  const committed = async () => {
    const doc = await document()
    return Object.values(doc.styles)
      .filter((style) => doc.nodes[id]!.classes.includes(style.class))
      .map((style) => `${style.property}:${JSON.stringify(style.value)}`)
  }
  const width = () => span.evaluate((element) => element.getBoundingClientRect().width)
  const start = await width()
  release = await press(page, '.handle.size.right', { dx: 40 })
  await release()
  await saved()
  expect(await committed()).toContain('display:{"type":"keyword","value":"inline-block"}')
  await expect.poll(width).toBeGreaterThan(start + 20)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect(await committed()).not.toContain('display:{"type":"keyword","value":"inline-block"}')
  // A vertical margin drag does the same; a horizontal one leaves the display alone.
  await span.dispatchEvent('click')
  await canvas.getByRole('button', { name: 'Spacing', exact: true }).click()
  await drag(page, '.handle.margin.top', { dy: -10 }, 2)
  await saved()
  expect(await committed()).toContain('display:{"type":"keyword","value":"inline-block"}')
}, 60_000)

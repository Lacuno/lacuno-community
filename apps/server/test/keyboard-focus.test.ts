import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('keeps the selection as the keyboard target wherever the focus sits, and says why a key refuses', async () => {
  const { page, canvas, saved, document } = await editor({ width: 1200, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let writes = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/document/apply')) writes++
  })
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  const selectedId = () => canvas.locator('[data-lacuno-selected]').getAttribute('data-lacuno-node')
  const margin = (side: string) =>
    cta.evaluate(
      (element, p) => Number.parseFloat(getComputedStyle(element).getPropertyValue(p)),
      `margin-${side}`,
    )
  const shown = (selector: string) =>
    canvas.locator(selector).evaluate((element) => element.checkVisibility())
  const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click()
  await cta.waitFor()
  await cta.click()
  await expect.poll(() => cta.getAttribute('data-lacuno-selected')).toBe('')
  const left0 = await margin('left')

  // A click on Undo or on a sidebar control takes the keyboard to the editor page; the arrows
  // and Delete still act on the selection from there.
  await page.keyboard.press('ArrowRight')
  await saved()
  expect(await margin('left')).toBe(left0 + 1)
  await undo()
  await saved()
  expect(await margin('left')).toBe(left0)
  await page.keyboard.press('ArrowRight')
  await saved()
  expect(await margin('left')).toBe(left0 + 1)
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.keyboard.press('ArrowRight')
  await saved()
  expect(await margin('left')).toBe(left0 + 2)
  await page.keyboard.press('Delete')
  await expect.poll(() => cta.count()).toBe(0)
  await undo()
  await cta.waitFor()

  // The Spacing chip keeps the focus after a click, and the arrows still nudge.
  await cta.click()
  await canvas.getByRole('button', { name: 'Spacing', exact: true }).click()
  await page.keyboard.press('ArrowRight')
  await saved()
  expect(await margin('left')).toBe(left0 + 3)
  // With the Align dialog open the arrows are the dialog's; Escape closes it and gives them back.
  await canvas.getByRole('button', { name: 'Align', exact: true }).click()
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  await menu.waitFor()
  let before = writes
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(400)
  expect(writes).toBe(before)
  await page.keyboard.press('Escape')
  await expect.poll(() => menu.isVisible()).toBe(false)
  await page.keyboard.press('ArrowRight')
  await saved()
  expect(await margin('left')).toBe(left0 + 4)

  // In Layers, Up and Down move the selection with the focus; the canvas follows.
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await page.locator('.layer.selected').focus()
  await page.keyboard.press('ArrowUp')
  await expect.poll(selectedId).toBe('n-home-lead')
  await expect
    .poll(() => page.locator('.layer.selected').getAttribute('data-drag-node'))
    .toBe('n-home-lead')
  await page.keyboard.press('ArrowDown')
  await expect.poll(selectedId).toBe('n-home-cta')

  // Alt+ArrowLeft moves the element earlier among its siblings, Alt+ArrowRight later.
  await cta.click()
  const siblings = () =>
    canvas
      .locator('[data-lacuno-node="n-home-hero-copy"]')
      .evaluate((element) =>
        Array.from(element.children, (child) => child.getAttribute('data-lacuno-node')),
      )
  const order = await siblings()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect.poll(siblings).toEqual([order[0], order[1], order[3], order[2]])
  await saved()
  await page.keyboard.press('Alt+ArrowRight')
  await expect.poll(siblings).toEqual(order)
  await saved()
  // A refused move says so on the status line and writes nothing.
  const kicker = canvas.locator('[data-lacuno-node="n-home-kicker"]')
  await kicker.click()
  await expect.poll(selectedId).toBe('n-home-kicker')
  before = writes
  await page.keyboard.press('Alt+ArrowUp')
  await expect
    .poll(() => page.locator('.save-state').textContent())
    .toBe('Already first in Container')
  expect(writes).toBe(before)
  await expect
    .poll(() => page.locator('.save-state').textContent(), { timeout: 5000 })
    .toBe('Saved')

  // Enter starts editing the selected text and Escape ends it, keeping what was typed.
  await cta.click()
  await page.keyboard.press('Enter')
  const textEditor = canvas.getByLabel('Canvas text editor')
  await textEditor.waitFor()
  await page.keyboard.type(' now')
  await page.keyboard.press('Escape')
  await expect.poll(() => textEditor.count()).toBe(0)
  await saved()
  expect(await cta.textContent()).toContain('now')
  await page.keyboard.press('ArrowRight')
  await saved()
  expect(await margin('left')).toBe(left0 + 5)

  // An auto margin is not nudged into pixels: the strip shows the auto instead. (A fresh
  // selection first: the inspector's draft from the nudge would keep painting its pixels.)
  await kicker.click()
  await cta.click()
  await expect.poll(selectedId).toBe('n-home-cta')
  await canvas.getByRole('button', { name: 'Align', exact: true }).click()
  await menu.getByRole('button', { name: 'Horizontal: Center', exact: true }).click()
  await saved()
  await page.keyboard.press('Escape')
  await expect.poll(() => menu.isVisible()).toBe(false)
  const typedMargin = (property: string) =>
    cta.evaluate((element, p) => String(element.computedStyleMap().get(p)), property)
  expect(await typedMargin('margin-left')).toBe('auto')
  before = writes
  await page.keyboard.press('ArrowRight')
  expect(await shown('.strip.margin.left')).toBe(true)
  expect(await canvas.locator('.strip.margin.left span').textContent()).toBe('auto')
  await page.waitForTimeout(400)
  expect(writes).toBe(before)
  expect(await typedMargin('margin-left')).toBe('auto')

  // The footer is a component instance with a box of its own: the arrows write its margin to a
  // local class of the instance. (The compiler does not yet put an instance's classes on the
  // rendered root, so the canvas cannot show the move until it does.)
  const footer = canvas.locator('[data-lacuno-node="n-home-footer"]')
  await footer.scrollIntoViewIfNeeded()
  await footer.click()
  await expect.poll(selectedId).toBe('n-home-footer')
  await page.keyboard.press('ArrowDown')
  await saved()
  const doc = await document()
  const local = doc.nodes['n-home-footer']!.classes.find((id) => doc.classes[id]?.kind === 'local')
  expect(
    Object.values(doc.styles).find(
      (style) => style.class === local && style.property === 'margin-top',
    )?.value,
  ).toEqual({ type: 'unit', value: 1, unit: 'px' })
  expect(errors).toEqual([])
}, 90_000)

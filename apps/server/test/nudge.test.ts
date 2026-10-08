import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('nudges the selection with the arrow keys: a burst is one write, Shift steps 10, Alt still reorders', async () => {
  const { page, canvas, saved } = await editor({ width: 1200, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let writes = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/document/apply')) writes++
  })
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()
  await expect.poll(() => cta.getAttribute('data-lacuno-selected')).toBe('')
  const margin = (side: string) =>
    cta.evaluate(
      (element, p) => Number.parseFloat(getComputedStyle(element).getPropertyValue(p)),
      `margin-${side}`,
    )
  const shown = (selector: string) =>
    canvas.locator(selector).evaluate((element) => element.checkVisibility())
  const left0 = await margin('left')
  const top0 = await margin('top')

  // Three quick presses preview as they go, show the margin's strip, and land as one write.
  let before = writes
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await expect.poll(() => margin('left')).toBe(left0 + 3)
  expect(await shown('.strip.margin.left')).toBe(true)
  await saved()
  expect(writes).toBe(before + 1)
  await expect.poll(() => shown('.strip.margin.left')).toBe(false)
  // Shift steps by 10, the other way; negative margins are allowed.
  before = writes
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await saved()
  expect(writes).toBe(before + 1)
  expect(await margin('left')).toBe(left0 - 17)
  // Up and down move the top margin; a held key commits when it is released.
  before = writes
  await page.keyboard.down('ArrowDown')
  await page.keyboard.down('ArrowDown')
  await page.keyboard.down('ArrowDown')
  await page.keyboard.up('ArrowDown')
  await saved()
  expect(writes).toBe(before + 1)
  expect(await margin('top')).toBe(top0 + 3)
  // Each burst is one undo step.
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => margin('top')).toBe(top0)
  expect(await margin('left')).toBe(left0 - 17)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => margin('left')).toBe(left0 + 3)

  // Alt and the arrows still move the selection among its siblings (the Undo clicks took the
  // keyboard to the editor page; a click brings it back to the canvas).
  await cta.click()
  const siblings = () =>
    canvas
      .locator('[data-lacuno-node="n-home-hero-copy"]')
      .evaluate((element) =>
        Array.from(element.children, (child) => child.getAttribute('data-lacuno-node')),
      )
  const order = await siblings()
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(siblings).toEqual([order[0], order[1], order[3], order[2]])
  await saved()
  expect(await margin('left')).toBe(left0 + 3)

  // Nothing moves while the text is being edited: the arrows belong to the caret.
  await cta.dblclick()
  await canvas.getByLabel('Canvas text editor').waitFor()
  before = writes
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(400)
  expect(writes).toBe(before)
  expect(await margin('left')).toBe(left0 + 3)
  expect(errors).toEqual([])
}, 60_000)

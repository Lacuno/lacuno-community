import { expect, it } from 'vitest'
import { editor } from './harness.js'

type Canvas = Awaited<ReturnType<typeof editor>>['canvas']

/** Selects `word` inside `element` the way a drag across it would. */
const select = (element: HTMLElement, word: string) => {
  const document = element.ownerDocument
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let text = walker.nextNode()!
  while (!text.textContent!.includes(word)) text = walker.nextNode()!
  const start = text.textContent!.indexOf(word)
  const range = document.createRange()
  range.setStart(text, start)
  range.setEnd(text, start + word.length)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

/** Opens a canvas bar swatch and clicks a project colour other than `not`; returns its colour. */
async function pickColor(canvas: Canvas, swatch: RegExp, not: string) {
  await canvas.getByRole('button', { name: swatch }).click()
  const dots = canvas.locator('.swatches button')
  await expect.poll(() => dots.count()).toBeGreaterThan(1)
  const colors = await dots.evaluateAll((all) =>
    all.map((dot) => getComputedStyle(dot).backgroundColor),
  )
  const index = colors.findIndex((color) => color !== not)
  await dots.nth(index).click()
  await canvas.getByRole('button', { name: swatch }).click()
  return colors[index]!
}

const colorOf = (canvas: Canvas, word: string) =>
  canvas
    .locator('[data-miralo-node="n-home-title"] span', { hasText: word })
    .evaluate((span) => getComputedStyle(span).color)

it('colours the selected words from the canvas bar while editing text', async () => {
  const { page, canvas, saved, document } = await editor()
  const heading = canvas.locator('[data-miralo-node="n-home-title"]')
  const style = (property: string) =>
    heading.evaluate((el, property) => getComputedStyle(el).getPropertyValue(property), property)
  const text = (await heading.textContent())!
  const word = text.split(' ')[1]!
  await heading.dblclick()
  const editable = canvas.getByLabel('Canvas text editor')
  await editable.waitFor()
  await editable.evaluate(select, word)
  await expect.poll(() => page.locator('.text-scope').textContent()).toBe('Selected text')

  // With words selected, the text swatch colours just them, and the selection stays.
  const elementColor = await style('color')
  const rangeColor = await pickColor(canvas, /^Text color: /, elementColor)
  expect(await colorOf(canvas, word)).toBe(rangeColor)
  expect(await style('color')).toBe(elementColor)
  expect(await page.locator('.text-scope').textContent()).toBe('Selected text')

  // With only a caret, both swatches act on the element, and the coloured words keep their colour.
  await editable.click()
  await expect.poll(() => page.locator('.text-scope').textContent()).toBe('Whole text')
  const background = await pickColor(canvas, /^Background color: /, await style('background-color'))
  expect(await style('background-color')).toBe(background)
  const wholeColor = await pickColor(canvas, /^Text color: /, rangeColor)
  expect(await style('color')).toBe(wholeColor)
  expect(await colorOf(canvas, word)).toBe(rangeColor)

  // Done saves the session as one write.
  let writes = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/document/apply')) writes++
  })
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await saved()
  expect(writes).toBe(1)
  expect(await heading.textContent()).toBe(text)
  expect(await colorOf(canvas, word)).toBe(rangeColor)
  expect(await style('color')).toBe(wholeColor)
  expect(await style('background-color')).toBe(background)
  expect(JSON.stringify((await document()).nodes['n-home-title'])).toContain('"color":"#')
}, 60000)

it('keeps range colours and the words when the whole text changes', async () => {
  const { page, canvas, saved, document } = await editor()
  const heading = canvas.locator('[data-miralo-node="n-home-title"]')
  const text = (await heading.textContent())!
  const [, sized, , colored] = text.split(' ') as [string, string, string, string]
  const format = async (word: string, label: string, value: string) => {
    await heading.dblclick()
    const editable = canvas.getByLabel('Canvas text editor')
    await editable.waitFor()
    await editable.evaluate(select, word)
    await page.getByLabel(label, { exact: true }).fill(value)
    await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
    await saved()
  }

  // Replacing the only range size leaves plain text; the panel must not save it empty.
  await format(sized, 'Size', '40px')
  await heading.click()
  await page.getByLabel('Size', { exact: true }).fill('20px')
  await saved()
  await expect
    .poll(async () => JSON.stringify((await document()).nodes['n-home-title']))
    .not.toContain('40px')
  expect(await heading.textContent()).toBe(text)

  // A whole-element colour from the canvas bar leaves a range's own colour alone, in one write.
  await format(colored, 'Text color', '#cc2244')
  await heading.click()
  let writes = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/document/apply')) writes++
  })
  const color = await pickColor(canvas, /^Text color: /, 'rgb(204, 34, 68)')
  await saved()
  await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).color)).toBe(color)
  expect(await colorOf(canvas, colored)).toBe('rgb(204, 34, 68)')
  await page.waitForTimeout(1000)
  expect(writes).toBe(1)
  expect(await heading.textContent()).toBe(text)
  expect(JSON.stringify((await document()).nodes['n-home-title'])).toContain('#cc2244')
}, 60000)

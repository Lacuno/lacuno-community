import { expect, it } from 'vitest'
import { clippedFocusRings, editor, openFormatting } from './harness.js'

it('aligns a child within its parent from the Align chip: the nine places, Distribute, one write each', async () => {
  const { page, canvas, saved } = await editor({ width: 1200, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let writes = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/document/apply')) writes++
  })
  const grid = canvas.locator('[data-lacuno-node="n-home-choice-grid"]')
  const child = canvas.locator('[data-lacuno-node="n-home-choice-hosted"]')
  const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click()
  const chip = canvas.getByRole('button', { name: 'Align', exact: true })
  const computed = (properties: string[]) =>
    child.evaluate((element, list) => {
      const style = getComputedStyle(element)
      const map = element.computedStyleMap()
      // Margins resolve to what they push by; the typed map keeps `auto`.
      return list.map((property) =>
        property.startsWith('margin')
          ? String(map.get(property))
          : style.getPropertyValue(property),
      )
    }, properties)
  const box = () => child.boundingBox()
  const place = async (name: string) => {
    await chip.click()
    await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('true')
    const before = writes
    await canvas.getByRole('menuitem', { name, exact: true }).click()
    await saved()
    expect(writes).toBe(before + 1)
  }
  // A Row: the parent's own grid in the sidebar, then the same place from the child's chip.
  await grid.dispatchEvent('click')
  await openFormatting(page, 'Layout')
  await page.getByRole('button', { name: 'Row layout', exact: true }).click()
  await saved()
  // The chip needs its selection on screen; boxes are compared without scrolling again.
  await child.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const xs = ['left', 'center', 'right']
  const ys = ['top', 'middle', 'bottom']
  for (const y of ys)
    for (const x of xs) {
      const name = `Align ${x} ${y}`
      await grid.dispatchEvent('click')
      await page.getByRole('button', { name, exact: true }).click()
      await saved()
      const expected = (await box())!
      await undo()
      await saved()
      await child.dispatchEvent('click')
      await expect.poll(() => child.getAttribute('data-lacuno-selected')).toBe('')
      await place(name)
      // The first child sits where the parent's alignment would put it.
      await expect.poll(async () => (await box())!.x).toBeCloseTo(expected.x, 0)
      expect((await box())!.y).toBeCloseTo(expected.y, 0)
      expect(await computed(['align-self', 'margin-left', 'margin-right'])).toEqual([
        { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[y],
        x === 'left' ? '0px' : 'auto',
        x === 'center' ? 'auto' : '0px',
      ])
    }
  // One undo step takes the whole place back, to the centre bottom placed before it.
  await undo()
  await saved()
  await expect
    .poll(() => computed(['align-self', 'margin-left', 'margin-right']))
    .toEqual(['flex-end', 'auto', 'auto'])
  // Distribute spreads the Row's children from the child's menu, through the parent.
  await place('Distribute')
  await expect
    .poll(() => grid.evaluate((el) => getComputedStyle(el).justifyContent))
    .toBe('space-between')
  await undo()
  await saved()
  await expect
    .poll(() => grid.evaluate((el) => getComputedStyle(el).justifyContent))
    .not.toBe('space-between')

  // A grid child places itself by justify-self and align-self.
  await grid.dispatchEvent('click')
  await page.getByRole('button', { name: 'Grid layout', exact: true }).click()
  await saved()
  await page.getByRole('button', { name: 'Align right bottom', exact: true }).click()
  await saved()
  const expected = (await box())!
  await undo()
  await saved()
  await child.dispatchEvent('click')
  await place('Align right bottom')
  await expect.poll(async () => (await box())!.x).toBeCloseTo(expected.x, 0)
  expect(await computed(['justify-self', 'align-self'])).toEqual(['end', 'end'])
  await chip.click()
  expect(await canvas.getByRole('menuitem', { name: 'Distribute' }).count()).toBe(0)
  expect(await clippedFocusRings(page, '.align-menu', canvas)).toEqual([])
  await page.keyboard.press('Escape')
  await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('false')

  // In a block parent only the sideways places remain, as margins.
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.click()
  await chip.click()
  await expect.poll(() => canvas.getByRole('menuitem').count()).toBe(3)
  const before = writes
  await canvas.getByRole('menuitem', { name: 'Align center middle', exact: true }).click()
  await saved()
  expect(writes).toBe(before + 1)
  await expect
    .poll(() =>
      cta.evaluate((el) =>
        ['margin-left', 'margin-right'].map((p) => String(el.computedStyleMap().get(p))),
      ),
    )
    .toEqual(['auto', 'auto'])
  // Text editing hides the chip like the handles.
  await cta.dblclick()
  await canvas.getByLabel('Canvas text editor').waitFor()
  await expect.poll(() => chip.count()).toBe(0)
  expect(errors).toEqual([])
}, 120_000)

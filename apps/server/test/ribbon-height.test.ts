import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('keeps the ribbon one height and the canvas in place in every state and width', async () => {
  const { page, canvas } = await editor()
  const node = (id: string) => canvas.locator(`[data-miralo-node="${id}"]`)
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const tabs = ['Home', 'Layout', 'Appearance', 'Effects', 'Motion']
  const tab = (name: string) =>
    page
      .getByRole('navigation', { name: 'Formatting categories' })
      .getByRole('button', { name, exact: true })
      .click()
  // The ribbon's height, the canvas panel's top and whether the ribbon's controls overflow it.
  const seen: Record<string, string> = {}
  let width = 0
  const measure = async (state: string) => {
    await page.waitForTimeout(300)
    seen[`${width} ${state}`] = await page.evaluate(() => {
      const ribbon = document.querySelector('.editor-ribbon')!.getBoundingClientRect()
      const canvas = document.querySelector('.canvas-panel')!.getBoundingClientRect()
      const body = document.querySelector('.ribbon-body')!
      return `${ribbon.height} ${canvas.top} ${body.scrollHeight > body.clientHeight}`
    })
  }
  const everyTab = async (state: string) => {
    for (const name of tabs) {
      await tab(name)
      await measure(`${state} · ${name}`)
    }
  }

  for (width of [1280, 1500, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await everyTab('nothing selected')
    await node('n-home-title').click()
    await everyTab('text')
    await node('n-home-hero').dispatchEvent('click')
    await everyTab('element')

    await node('n-home-cta').click()
    if (width === 1500) {
      // The Layout tab fits a 1500px window with the design tokens in view.
      await tab('Layout')
      const body = page.locator('.ribbon-body')
      expect(await body.evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0)
      const swatches = (await page.locator('.ribbon-swatches').boundingBox())!
      expect(swatches.x + swatches.width).toBeLessThanOrEqual(1500)
    }
    await canvas.getByRole('button', { name: /^State: / }).click()
    await canvas.getByRole('menuitemradio', { name: 'Hover' }).click()
    await everyTab('hover state')
    await canvas.getByRole('button', { name: /^State: / }).click()
    await canvas.getByRole('menuitemradio', { name: 'Default' }).click()

    await tab('Home')
    await node('n-home-title').dblclick()
    const editable = canvas.getByLabel('Canvas text editor')
    await editable.waitFor()
    await measure('inline text · caret')
    await editable.evaluate((element) => {
      const range = element.ownerDocument.createRange()
      range.selectNodeContents(element.firstChild!)
      element.ownerDocument.getSelection()!.removeAllRanges()
      element.ownerDocument.getSelection()!.addRange(range)
      element.ownerDocument.dispatchEvent(new Event('selectionchange'))
    })
    await expect.poll(() => page.locator('.text-scope').textContent()).toBe('Selected text')
    await measure('inline text · selection')
    await button('Done editing text').click()

    await node('n-home-header').dispatchEvent('click')
    await measure('component instance')
    await button('Components').click()
    await button('Edit shared component').click()
    await node('n-header-brand').waitFor()
    await node('n-header-brand').click()
    await everyTab('shared component')
    await button('Done').click()
    await button('Layers').click()
    const workspace = (await page.locator('.canvas-workspace').boundingBox())!
    await page.mouse.click(workspace.x + 10, workspace.y + workspace.height / 2)
  }
  const first = Object.values(seen)[0]
  expect(first).toMatch(/ false$/)
  expect(seen).toEqual(Object.fromEntries(Object.keys(seen).map((state) => [state, first])))
}, 240_000)

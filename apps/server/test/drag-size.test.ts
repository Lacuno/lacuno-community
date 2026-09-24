import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('drags an element at its size on the zoomed canvas', async () => {
  const { context, page, canvas } = await editor({ width: 1200, height: 1000 })
  const ghost = page
    .frameLocator('iframe[title="Drag preview"]')
    .locator('[data-miralo-drag-ghost]')
  const heading = canvas.locator('[data-miralo-node="n-home-title"]')
  const lead = canvas.locator('[data-miralo-node="n-home-lead"]')
  const cdp = await context.newCDPSession(page)
  const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    })
  // The dragged element keeps its canvas size and grab point at every canvas zoom.
  for (const preset of ['Desktop', 'Tablet']) {
    await page.getByRole('button', { name: preset, exact: true }).click()
    await heading.click()
    const box = (await heading.boundingBox())!
    const from = { x: box.x + 40, y: box.y + box.height / 2 }
    const to = { x: from.x, y: (await lead.boundingBox())!.y + 10 }
    await mouse('mousePressed', from.x, from.y)
    for (let step = 1; step <= 10; step++)
      await mouse('mouseMoved', to.x, from.y + ((to.y - from.y) * step) / 10)
    await expect.poll(() => ghost.count()).toBe(1)
    await mouse('mouseMoved', to.x, to.y)
    await expect
      .poll(async () => (await ghost.boundingBox())!.y - (to.y - (from.y - box.y)))
      .toBeCloseTo(0, 0)
    const dragged = (await ghost.boundingBox())!
    expect(dragged.width).toBeCloseTo(box.width, 0)
    expect(dragged.height).toBeCloseTo(box.height, 0)
    expect(dragged.x).toBeCloseTo(box.x, 0)
    await cdp.send('Input.cancelDragging')
    await page.keyboard.press('Escape')
    await mouse('mouseReleased', to.x, to.y)
    await expect.poll(() => ghost.count()).toBe(0)
  }
}, 40000)

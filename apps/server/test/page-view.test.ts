import { readFile } from 'node:fs/promises'
import { type Browser, chromium, type Page } from 'playwright'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The host side of MCP Apps, by hand: the view in an iframe, its messages recorded, initialize
// answered, then the tool's input and result sent. tools/call and ui/message are acknowledged.
const view = await readFile(
  new URL('../../../packages/mcp/src/page-view.html', import.meta.url),
  'utf8',
)
const result = {
  site: 'Test site',
  page: { id: 'p-home', name: 'Home', path: '/' },
  width: 1280,
  height: 800,
  boxes: [
    { id: 'n-home', label: 'main', tag: 'main', depth: 0, x: 0, y: 0, w: 1280, h: 800 },
    { id: 'n-hero', label: 'Hero', tag: 'section', depth: 1, x: 0, y: 0, w: 1280, h: 400 },
    { id: 'n-hero-title', label: 'h1', tag: 'h1', depth: 2, x: 100, y: 100, w: 600, h: 80 },
  ],
}
const jpeg = await sharp({ create: { width: 128, height: 80, channels: 3, background: '#ccc' } })
  .jpeg()
  .toBuffer()
const shotResult = {
  content: [
    { type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' },
    { type: 'text', text: '128×80' },
  ],
}
const host = `<!doctype html><body style="margin:0">
<iframe id="view" style="width:640px;height:800px;border:0"></iframe>
<script>
  const messages = (window.messages = [])
  const viewResult = (width) => ({ content: [{ type: 'text', text: JSON.stringify({ ...${JSON.stringify(result)}, width }) }] })
  const send = (message) => document.getElementById('view').contentWindow.postMessage({ jsonrpc: '2.0', ...message }, '*')
  addEventListener('message', ({ data }) => {
    messages.push(data)
    if (data.method === 'ui/initialize')
      send({ id: data.id, result: { protocolVersion: '2025-06-18', hostCapabilities: {}, hostContext: { theme: 'light', containerDimensions: { maxHeight: 2000 } } } })
    else if (data.method === 'ui/notifications/initialized') {
      send({ method: 'ui/notifications/tool-input', params: { arguments: { site: 's1', page: '/' } } })
      send({ method: 'ui/notifications/tool-result', params: viewResult(1280) })
    } else if (data.method === 'ui/message') send({ id: data.id, result: {} })
    else if (data.method === 'tools/call')
      send({ id: data.id, result: data.params.name === 'page.screenshot' ? ${JSON.stringify(shotResult)} : viewResult(data.params.arguments.width) })
  })
</script>`

let browser: Browser
let page: Page
beforeAll(async () => {
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 800, height: 900 } })
  await page.setContent(host)
  await page.evaluate((html) => {
    document.querySelector<HTMLIFrameElement>('#view')!.srcdoc = html
  }, view)
})
afterAll(async () => {
  await browser.close()
})

type Message = {
  method?: string
  params?: { name?: string; arguments?: object; content?: { text: string }; height?: number }
}
const sent = (method: string) =>
  page.evaluate(
    (method) =>
      (window as unknown as { messages: Message[] }).messages.filter((m) => m.method === method),
    method,
  )

describe('the page view', () => {
  it('draws the page and its boxes at the frame width, points, fixes, asks and refreshes', async () => {
    const frame = page.frameLocator('#view')
    const image = frame.locator('#image')
    await expect.poll(() => image.boundingBox().then((b) => b?.width)).toBe(640)
    // The picture is fetched by the view itself, the whole page at the result's width.
    await expect.poll(() => sent('tools/call')).toHaveLength(1)
    expect((await sent('tools/call'))[0]?.params).toEqual({
      name: 'page.screenshot',
      arguments: { site: 's1', page: '/', width: 1280, fullPage: true, maxHeight: 4000 },
    })
    await expect.poll(() => image.boundingBox().then((b) => b?.height)).toBe(400)
    const top = (await image.boundingBox())!.y
    const boxes = frame.locator('.box')
    expect(await boxes.count()).toBe(3)
    // The hero spans the width and half the page, scaled with the image.
    expect(await boxes.nth(1).boundingBox()).toMatchObject({
      x: 0,
      y: top,
      width: 640,
      height: 200,
    })
    expect(await frame.locator('#name').textContent()).toBe('Home')

    // Hovering shows the smallest box's label: the title inside the hero.
    await page.mouse.move(100, top + 60)
    await expect.poll(() => frame.locator('.box.hot span').textContent()).toBe('h1')
    await page.mouse.move(400, top + 150)
    await expect.poll(() => frame.locator('.box.hot span').textContent()).toBe('Hero')
    await page.mouse.click(400, top + 150)
    await expect.poll(() => frame.locator('.box.selected').getAttribute('aria-label')).toBe('Hero')
    const fix = frame.getByRole('button', { name: 'Fix Hero' })
    await expect.poll(() => fix.isVisible()).toBe(true)
    await fix.click()
    await expect.poll(() => sent('ui/message')).toHaveLength(1)
    expect((await sent('ui/message'))[0]?.params).toEqual({
      role: 'user',
      content: {
        type: 'text',
        text: 'In Lacuno, on the site "Test site", open the page "Home" (/) and look at the Hero (element n-hero). Fix what looks off: align it with its neighbours, make its spacing match the rest of the page, and keep the text readable at phone width. Keep the change small, check it with a screenshot, then tell me what you changed.',
      },
    })
    await expect
      .poll(() => frame.locator('#status').textContent())
      .toBe('Sent to the chat. Refresh when it is done.')

    await frame.getByLabel('Ask about Hero').fill('make it blue')
    await frame.getByRole('button', { name: 'Send' }).click()
    await expect.poll(() => sent('ui/message')).toHaveLength(2)
    expect((await sent('ui/message'))[1]?.params?.content?.text).toBe(
      'In Lacuno, on the site "Test site", on the page "Home" (/), the Hero (element n-hero): make it blue.',
    )

    await frame.getByRole('button', { name: 'Phone' }).click()
    await expect.poll(() => sent('tools/call')).toHaveLength(3)
    expect((await sent('tools/call')).slice(1).map((m) => m.params)).toEqual([
      { name: 'page.view', arguments: { site: 's1', page: '/', width: 390 } },
      {
        name: 'page.screenshot',
        arguments: { site: 's1', page: '/', width: 390, fullPage: true, maxHeight: 4000 },
      },
    ])
    await expect.poll(() => frame.locator('#status').textContent()).toBe('')
    // A fresh result clears the selection; Escape would too.
    await expect.poll(() => frame.locator('.box.selected').count()).toBe(0)
    await boxes.nth(1).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => fix.isVisible()).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => fix.isVisible()).toBe(false)

    const sizes = await sent('ui/notifications/size-changed')
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.at(-1)?.params?.height).toBeGreaterThan(400)
  })
})

import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { root } from './harness.js'

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
}

it('edits the template in the browser with a service worker as its server', async () => {
  // The editor dist as a static host serves it: files only, so every API request stays in the page.
  const dist = path.join(root, 'apps/editor/dist')
  const requested: string[] = []
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, 'http://host').pathname
    requested.push(pathname)
    try {
      const file = pathname === '/' ? 'try.html' : pathname.slice(1)
      const body = await readFile(path.join(dist, file))
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const browser = await chromium.launch({ headless: true })
  onTestFinished(async () => {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  })
  const page = await (
    await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  ).newPage()
  page.context().setDefaultTimeout(8000)
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
  const canvas = page.frameLocator('iframe[title="Site canvas"]')
  const heading = canvas.locator('[data-freeflow-node="n-home-title"]')
  expect(await heading.textContent()).toBe('Your website. Your rules.')
  expect(new URL(page.url()).search).toBe('?site=try')
  const saved = () =>
    expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')

  await heading.click()
  await page.getByLabel('Text', { exact: true }).fill('Made in the browser.')
  await saved()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByLabel('Background color', { exact: true }).fill('#ff0000')
  await saved()
  const background = () => heading.evaluate((element) => getComputedStyle(element).backgroundColor)
  await expect.poll(background).toBe('rgb(255, 0, 0)')

  await page.reload()
  await expect.poll(() => heading.textContent()).toBe('Made in the browser.')
  expect(await background()).toBe('rgb(255, 0, 0)')
  expect(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled()).toBe(true)
  await heading.click()
  await page.getByLabel('Text', { exact: true }).fill('Undo me')
  await saved()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => heading.textContent()).toBe('Made in the browser.')

  // Uploaded bytes live in IndexedDB and reach the canvas through the worker.
  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas')
    image.width = 40
    image.height = 30
    return image.toDataURL('image/png').split(',')[1]!
  })
  await page.getByLabel('Upload image, video or font', { exact: true }).setInputFiles({
    name: 'card.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await heading.click()
  await page.getByRole('button', { name: 'Insert card.png', exact: true }).click()
  await saved()
  await expect
    .poll(() =>
      canvas
        .locator('img[src^="/api/sites/try/assets/"]')
        .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).naturalWidth)),
    )
    .toContain(40)

  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const publishing = page.getByRole('dialog', { name: 'Publishing and release history' })
  await publishing.getByText('Sign up to publish your site.').waitFor()
  expect(await publishing.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe(
    '/signup',
  )
  await publishing.getByRole('button', { name: 'Close publishing' }).click()
  await page.locator('.connect-trigger').click()
  const connect = page.getByRole('dialog', { name: 'Connect your AI' })
  await connect.getByText('Sign up to connect your AI.').waitFor()
  expect(await connect.locator('.connect-app').count()).toBe(0)
  await connect.getByRole('button', { name: 'Close connect your AI' }).click()
  expect(await page.locator('.editor-header').getByRole('link', { name: 'Sign up' }).count()).toBe(
    1,
  )

  expect(requested.filter((pathname) => pathname.startsWith('/api/'))).toEqual([])
})

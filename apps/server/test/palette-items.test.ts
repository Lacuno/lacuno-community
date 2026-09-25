import type { Locator } from 'playwright'
import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('inserts a list, span, video and embed from the palette and publishes them', async () => {
  const { server, page, canvas, publish, saved } = await editor()
  await canvas.locator('[data-lacuno-node="n-home-cta"]').waitFor()

  const insert = async (name: string) => {
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name: 'Insert element', exact: true }).click()
    await saved()
  }
  const editText = async (element: Locator, words: string) => {
    // The selection chrome can cover short text, so the double-click goes to the element itself.
    await element.dispatchEvent('dblclick')
    const editable = canvas.getByLabel('Canvas text editor')
    await editable.waitFor()
    await editable.pressSequentially(words)
    await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
    await saved()
  }

  // A list is a ul of three items; the inspector switches it to numbered in place.
  await insert('List')
  await page.getByLabel('List type', { exact: true }).selectOption('ol')
  await saved()
  const item = canvas.locator('ol > li', { hasText: 'Second item' })
  await item.waitFor()
  await editText(item, ' edited')
  await expect.poll(() => item.textContent()).toBe('Second item edited')

  // A span is inline text, edited like any other text.
  await insert('Span')
  const span = canvas.locator('span[data-lacuno-node]', { hasText: 'Span' })
  await editText(span, ' text')
  await expect.poll(() => span.textContent()).toBe('Span text')

  // A video without a source is a placeholder until an uploaded clip is chosen.
  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  await page.getByLabel('Upload image, video or font', { exact: true }).setInputFiles({
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('AAAAGGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQ==', 'base64'),
  })
  await page.getByRole('button', { name: 'Insert clip.mp4', exact: true }).waitFor()
  await insert('Video')
  await canvas.locator('[data-lacuno-placeholder="Video"]').waitFor()
  await page.getByRole('button', { name: 'Choose video', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Video library' })
    .getByRole('button', { name: 'Choose clip.mp4', exact: true })
    .click()
  await saved()
  await canvas.locator('video[src^="/api/sites/"]').waitFor()
  // Browsers refuse unmuted autoplay, so turning it on mutes the video too. The toggles show
  // the saved attributes, so each click is followed by a save.
  const toggle = async (name: string, checked: boolean) => {
    await page.getByLabel(name, { exact: true }).click()
    await saved()
    await expect.poll(() => page.getByLabel(name, { exact: true }).isChecked()).toBe(checked)
  }
  await toggle('Autoplay', true)
  await expect.poll(() => page.getByLabel('Muted', { exact: true }).isChecked()).toBe(true)
  await toggle('Autoplay', false)
  await toggle('Muted', false)

  // Embed code never runs on the canvas, so an iframe-only embed shows a labelled placeholder.
  await insert('Embed')
  await page.getByRole('button', { name: 'About embed code' }).click()
  await page.getByText('Paste the HTML snippet a service gives you').waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  await page
    .getByLabel('Embed code', { exact: true })
    .fill('<iframe src="https://example.com"></iframe>')
  await page.getByLabel('Embed code', { exact: true }).blur()
  await saved()
  await canvas.locator('[data-lacuno-placeholder="Embed"] iframe').waitFor({ state: 'attached' })
  // Styling an embed publishes a wrapper that carries its class.
  await page.getByRole('button', { name: 'Layout', exact: true }).click()
  await page
    .locator('.ribbon-controls')
    .getByLabel('Inside spacing top', { exact: true })
    .fill('20')
  await expect
    .poll(() =>
      canvas
        .locator('[data-lacuno-embed]')
        .evaluate((element) => getComputedStyle(element).paddingTop),
    )
    .toBe('20px')
  await saved()

  const published = await (await server.published!.request(`${await publish()}/`)).text()
  expect(published).toMatch(/<ol[^>]*><li[^>]*>First item<\/li><li[^>]*>Second item edited<\/li>/)
  expect(published).toMatch(/<span[^>]*>Span text<\/span>/)
  expect(published).toMatch(
    /<video class="[^"]+" controls playsinline src="\/assets\/[a-f0-9]{64}\.mp4"><\/video>/,
  )
  expect(published).toMatch(
    /<div class="[^"]+"><iframe src="https:\/\/example.com"><\/iframe><\/div>/,
  )
}, 240_000)

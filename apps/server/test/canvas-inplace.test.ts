import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('morphs the canvas in place, so nothing reloads across commits', async () => {
  const { page, canvas, saved } = await editor()
  // A sentinel on the iframe document; it can only survive if the document is never replaced.
  const sentinel = () =>
    canvas.locator('body').evaluate(() => (document as unknown as { __ff?: string }).__ff ?? '')
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()
  await canvas.locator('body').evaluate(() => {
    ;(document as unknown as { __ff?: string }).__ff = 'kept'
  })
  expect(await sentinel()).toBe('kept')

  // The swatches commit on close: pick a dot to preview, re-click the swatch to commit and close.
  const commitColor = async (label: RegExp, dot: number) => {
    await canvas.getByRole('button', { name: label }).click()
    await expect.poll(() => canvas.locator('.wheel').count()).toBe(1)
    await canvas.locator('.swatches button').nth(dot).click()
    await canvas.getByRole('button', { name: label }).click()
    await saved()
  }

  // First colour commit: the CTA text starts ink, so a different dot changes its colour.
  const startColor = await cta.evaluate((element) => getComputedStyle(element).color)
  await commitColor(/^Text color: /, 0)
  await expect
    .poll(() => cta.evaluate((element) => getComputedStyle(element).color))
    .not.toBe(startColor)
  expect(await sentinel()).toBe('kept')

  // Second colour commit: a background colour, a distinct dot.
  const startBackground = await cta.evaluate((element) => getComputedStyle(element).backgroundColor)
  await commitColor(/^Background color: /, 2)
  await expect
    .poll(() => cta.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(startBackground)
  expect(await sentinel()).toBe('kept')

  // A text edit commit.
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.click()
  await page.getByLabel('Text', { exact: true }).fill('Morphed in place')
  await expect.poll(() => heading.textContent()).toBe('Morphed in place')
  await saved()
  expect(await sentinel()).toBe('kept')

  // A structural insert commit.
  await heading.click()
  await page.getByRole('button', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Heading', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await canvas.getByRole('heading', { name: 'Your new heading', exact: true }).waitFor()
  await saved()
  expect(await sentinel()).toBe('kept')

  // The acute case: committing the text colour must not close the background wheel opened next.
  await cta.click()
  await canvas.getByRole('button', { name: /^Text color: / }).click()
  await expect.poll(() => canvas.locator('.wheel').count()).toBe(1)
  await canvas.locator('.swatches button').nth(4).click()
  // The pick commits the text colour; the background swatch opens the background wheel.
  await canvas.getByRole('button', { name: /^Background color: / }).click()
  await expect
    .poll(() =>
      canvas.getByRole('button', { name: /^Background color: / }).getAttribute('aria-expanded'),
    )
    .toBe('true')
  await saved()
  // The commit's morph did not reload the iframe, so the background wheel is still open.
  expect(await canvas.locator('.color-menu:not([hidden])').count()).toBe(1)
  expect(
    await canvas.getByRole('button', { name: /^Background color: / }).getAttribute('aria-expanded'),
  ).toBe('true')
  expect(await sentinel()).toBe('kept')

  // The reported flicker: with the background wheel open, pick a colour. Its commit must not drop
  // the preview before the new render lands, so from the first frame that shows the picked
  // background every frame shows it, never the one it replaces. Transitions are off so a frame
  // shows exactly the value applied, not a blend.
  await canvas.locator('head').evaluate((head) => {
    head.append(
      Object.assign(document.createElement('style'), {
        textContent: '* { transition: none !important }',
      }),
    )
  })
  const committed = await cta.evaluate((element) => getComputedStyle(element).backgroundColor)
  // The canvas iframe runs no scripts of its own, so the editor page samples it every frame until
  // the test ends, looking the CTA up each time in case a morph replaces it.
  await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>('iframe[title="Site canvas"]')!
      .contentDocument!
    const styles = () => Array.from(doc.head.querySelectorAll('style'), (s) => s.textContent).join()
    const before = styles()
    const record = { frames: [] as string[], morphed: false }
    ;(window as unknown as { __frames?: typeof record }).__frames = record
    const sample = () => {
      const element = doc.querySelector('[data-lacuno-node="n-home-cta"]')!
      record.frames.push(getComputedStyle(element).backgroundColor)
      record.morphed ||= styles() !== before
      requestAnimationFrame(sample)
    }
    sample()
  })
  await canvas.locator('.swatches button').nth(1).click()
  const frames = () =>
    page.evaluate(
      () => (window as unknown as { __frames: { frames: string[]; morphed: boolean } }).__frames,
    )
  await expect.poll(async () => (await frames()).morphed).toBe(true)
  const picked = await cta.evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(picked).not.toBe(committed)
  const sampled = (await frames()).frames
  expect(new Set(sampled.slice(sampled.indexOf(picked)))).toEqual(new Set([picked]))
}, 60000)

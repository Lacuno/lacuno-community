import { expect, it } from 'vitest'
import { editor, openFormatting } from './harness.js'

const localStyles = async (document: Awaited<ReturnType<typeof editor>>['document']) => {
  const doc = await document()
  const node = doc.nodes['n-home-title']!
  return Object.fromEntries(
    Object.values(doc.styles)
      .filter(
        (style) => node.classes.includes(style.class) && doc.classes[style.class]?.kind === 'local',
      )
      .map((style) => [style.property, style.value]),
  )
}

it('edits a gradient headline: angle, stops with project colours, and text fill', async () => {
  const { page, canvas, saved, document } = await editor()
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  const computed = (property: string) =>
    heading.evaluate((el, property) => getComputedStyle(el).getPropertyValue(property), property)
  await heading.click()
  const colors = await openFormatting(page, 'Colors')
  await colors.getByRole('button', { name: 'Add gradient' }).click()
  await saved()
  await colors.getByLabel('Gradient angle').fill('90')
  await saved()
  expect(await computed('background-image')).toMatch(/^linear-gradient\(90deg, /)

  // Pressing the bar adds a stop there, selected, in the colour of its nearest stop.
  const bar = colors.locator('.gradient-bar')
  const box = (await bar.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(() => colors.locator('.gradient-stop').count()).toBe(3)
  expect(
    await colors.getByRole('button', { name: /^Stop 2 at 50%/ }).getAttribute('aria-pressed'),
  ).toBe('true')
  await colors.getByLabel('Stop color source').selectOption({ label: 'Accent' })
  await saved()

  // The last stop moves with the keyboard, and dragging moves a stop past another.
  await colors.getByRole('button', { name: 'Stop 3 at 100%' }).press('Shift+ArrowLeft')
  await saved()
  const first = (await colors.getByRole('button', { name: 'Stop 1 at 0%' }).boundingBox())!
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, first.y + first.height / 2, { steps: 5 })
  await page.mouse.up()
  await saved()
  let gradient = (await localStyles(document))['background-image']
  expect(gradient).toMatchObject({
    type: 'gradient',
    kind: 'linear',
    angle: 90,
    stops: [
      { position: 50, color: { type: 'designToken', ref: 't-color-accent' } },
      { position: expect.closeTo(70, -1) },
      { position: 90 },
    ],
  })

  await colors.getByLabel('Fill text').check()
  await saved()
  expect(await computed('background-clip')).toBe('text')
  expect(await computed('color')).toBe('rgba(0, 0, 0, 0)')
  expect(await localStyles(document)).toMatchObject({
    'background-clip': { type: 'keyword', value: 'text' },
    color: { type: 'keyword', value: 'transparent' },
  })

  // A stop can go while two remain; removing the gradient also ends the text fill.
  await colors.getByRole('button', { name: 'Remove stop' }).click()
  await saved()
  gradient = (await localStyles(document))['background-image']
  expect(gradient?.type === 'gradient' && gradient.stops.length).toBe(2)
  expect(await colors.getByRole('button', { name: 'Remove stop' }).isDisabled()).toBe(true)
  await colors.getByRole('button', { name: 'Remove gradient' }).click()
  await saved()
  expect(Object.keys(await localStyles(document))).not.toContain('background-image')
  expect(Object.keys(await localStyles(document))).not.toContain('background-clip')
  expect(await computed('background-image')).toBe('none')
}, 60000)

it('rotates words in a headline on the canvas, sized to the current word', async () => {
  const { page, canvas, saved, document } = await editor()
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.click()
  const motion = await openFormatting(page, 'Motion')
  await motion.getByLabel('Rotating words').fill('designer, you')
  await motion.getByLabel('Rotating words').press('Enter')
  await saved()
  expect((await document()).nodes['n-home-title']).toMatchObject({
    rotatingWords: { words: ['designer', 'you'] },
  })
  const list = heading.locator('[data-lc-words="3"]')
  await expect
    .poll(() => list.locator(':scope > span').allTextContents())
    .toEqual([expect.any(String), 'designer', 'you'])
  // The editor measures the words, since the canvas sandbox runs no page scripts.
  await expect
    .poll(() => list.evaluate((el) => el.style.getPropertyValue('--lc-w2')))
    .toMatch(/em$/)

  await motion.getByLabel('Word transition').selectOption('Fade')
  await saved()
  await motion.getByLabel('Word interval').fill('3000')
  await motion.getByLabel('Word interval').press('Enter')
  await saved()
  await expect.poll(() => list.getAttribute('data-lc-fade')).toBe('')
  expect(await list.getAttribute('style')).toMatch(/--lc-interval: ?3000ms/)
  expect((await document()).nodes['n-home-title']).toMatchObject({
    rotatingWords: { words: ['designer', 'you'], interval: 3000, transition: 'fade' },
  })

  await motion.getByLabel('Rotating words').fill('')
  await motion.getByLabel('Rotating words').press('Enter')
  await saved()
  expect((await document()).nodes['n-home-title']).not.toHaveProperty('rotatingWords')
  await expect.poll(() => heading.locator('[data-lc-words]').count()).toBe(0)
}, 60000)

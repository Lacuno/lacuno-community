import { expect, it } from 'vitest'
import { editor, openFormatting, openInspectorTab } from './harness.js'

const text = (id: string, parent: string, cls: string, value: string) => ({
  type: 'node.create',
  parent,
  node: {
    id,
    type: 'text',
    tag: 'h2',
    classes: [cls],
    children: [],
    text: { type: 'static', value },
  },
})

it('sets animation, trigger, range and story length in the Motion section', async () => {
  const { context, origin, siteId, document, page, canvas, saved } = await editor({
    width: 1400,
    height: 900,
  })
  // A heading, and a story whose stage holds one step.
  const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: (await document()).revision,
      operations: [
        ...['c-hero', 'c-story', 'c-stage', 'c-step'].map((id) => ({
          type: 'class.create',
          id,
          local: true,
        })),
        text('n-hero', 'n-home-main', 'c-hero', 'Hello.'),
        {
          type: 'node.create',
          parent: 'n-home-main',
          node: {
            id: 'n-story',
            type: 'element',
            tag: 'section',
            classes: ['c-story'],
            children: [],
            attrs: { 'data-lc-story': { type: 'static', value: true } },
          },
        },
        {
          type: 'node.create',
          parent: 'n-story',
          node: { id: 'n-stage', type: 'element', tag: 'div', classes: ['c-stage'], children: [] },
        },
        text('n-step', 'n-stage', 'c-step', 'Light.'),
      ],
    },
  })
  expect(response.status()).toBe(200)
  const style = async (cls: string, property: string, breakpoint = 'base') =>
    (await document()).styles[`${cls}|${breakpoint}|none|${property}`]?.value
  const raw = (value: string) => ({ type: 'raw', value })
  const animation = page.getByLabel('Motion animation', { exact: true })
  const range = page.getByLabel('Motion range', { exact: true })
  const onEnter = page.getByRole('button', { name: 'On enter', exact: true })
  const follow = page.getByRole('button', { name: 'Follow scroll', exact: true })
  const options = () => range.locator('option').allTextContents()

  const hero = canvas.locator('[data-lacuno-node="n-hero"]')
  await hero.scrollIntoViewIfNeeded()
  await hero.click()
  await expect.poll(() => hero.getAttribute('data-lacuno-selected')).toBe('')
  // Collapsed by default, and no hint under the controls.
  await openInspectorTab(page, 'Style')
  const section = page.locator('aside.inspector details[data-group="Motion"]')
  expect(await section.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false)
  expect(await section.locator('.hint, p').count()).toBe(0)
  await openFormatting(page, 'Motion')

  // Parallax only follows the scroll, over the whole view.
  await animation.selectOption('lc-parallax')
  await saved()
  expect(await style('c-hero', '--lc-scroll')).toEqual(raw('lc-parallax'))
  expect(await style('c-hero', '--lc-entrance')).toBeUndefined()
  expect(await style('c-hero', '--lc-range')).toEqual(raw('cover'))
  expect(await follow.getAttribute('aria-pressed')).toBe('true')
  expect(await onEnter.isDisabled()).toBe(true)
  expect(await range.inputValue()).toBe('cover')
  expect(await options()).toEqual(['Entering', 'Visible', 'Leaving'])

  // Fade in keeps following the scroll, without Parallax's range; the trigger moves the name.
  await animation.selectOption('lc-fade')
  await saved()
  expect(await style('c-hero', '--lc-scroll')).toEqual(raw('lc-fade'))
  expect(await style('c-hero', '--lc-range')).toBeUndefined()
  await onEnter.click()
  await saved()
  expect(await style('c-hero', '--lc-entrance')).toEqual(raw('lc-fade'))
  expect(await style('c-hero', '--lc-scroll')).toBeUndefined()
  expect(await page.getByLabel('Motion duration', { exact: true }).count()).toBe(1)
  expect(await range.count()).toBe(0)
  await follow.click()
  await saved()
  expect(await style('c-hero', '--lc-scroll')).toEqual(raw('lc-fade'))
  expect(await style('c-hero', '--lc-entrance')).toBeUndefined()

  // Reading progress follows the page's scroll; its range shows as written.
  await animation.selectOption('lc-progress')
  await saved()
  expect(await style('c-hero', '--lc-scroll')).toEqual(raw('lc-progress'))
  expect(await style('c-hero', '--lc-timeline')).toEqual(raw('scroll()'))
  expect(await style('c-hero', '--lc-range')).toEqual(raw('normal'))
  expect(await range.inputValue()).toBe('normal')

  // Preview on a scroll animation turns on the canvas's motion preview.
  const root = canvas.locator('html')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect.poll(() => root.getAttribute('data-lacuno-still')).toBeNull()
  await page.keyboard.press('Escape')
  await expect.poll(() => root.getAttribute('data-lacuno-still')).toBe('')

  // None on Mobile overrides there and keeps the base.
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect
    .poll(() => page.getByLabel('Editing breakpoint').locator('option:checked').textContent())
    .toContain('Mobile')
  await animation.selectOption('none')
  await saved()
  expect(await style('c-hero', '--lc-scroll', 'mobile-p')).toEqual(raw('none'))
  expect(await style('c-hero', '--lc-scroll')).toEqual(raw('lc-progress'))
  expect(await animation.getAttribute('data-overridden')).toBe('true')
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await expect.poll(() => animation.inputValue()).toBe('lc-progress')

  // Reset clears the Motion fields.
  await openInspectorTab(page, 'Advanced')
  await page.getByRole('button', { name: 'Reset formatting', exact: true }).click()
  await saved()
  for (const property of ['--lc-scroll', '--lc-timeline', '--lc-range'])
    expect(await style('c-hero', property)).toBeUndefined()

  // A step takes its turn in the story, or follows the whole story.
  const step = canvas.locator('[data-lacuno-node="n-step"]')
  await step.scrollIntoViewIfNeeded()
  await step.click()
  await expect.poll(() => step.getAttribute('data-lacuno-selected')).toBe('')
  await openFormatting(page, 'Motion')
  await animation.selectOption('lc-fade-through')
  await saved()
  expect(await style('c-step', '--lc-scroll')).toEqual(raw('lc-fade-through'))
  expect(await range.inputValue()).toBe('')
  expect(await options()).toEqual(['In turn', 'Whole story', 'Entering'])

  // The story's length in screens, by default one more than its steps.
  const inspector = page.locator('aside.inspector')
  await inspector.locator('.inspector-parent').click()
  await expect
    .poll(() => canvas.locator('[data-lacuno-node="n-stage"]').getAttribute('data-lacuno-selected'))
    .toBe('')
  await inspector.locator('.inspector-parent').click()
  await expect
    .poll(() => canvas.locator('[data-lacuno-node="n-story"]').getAttribute('data-lacuno-selected'))
    .toBe('')
  await openFormatting(page, 'Motion')
  const length = page.getByLabel('Story length', { exact: true })
  expect(await length.getAttribute('placeholder')).toBe('2')
  await length.fill('6')
  await saved()
  expect(await style('c-story', '--lc-length')).toEqual(raw('6'))

  // Back on the step, Whole story writes contain.
  await step.click()
  await expect.poll(() => step.getAttribute('data-lacuno-selected')).toBe('')
  await openFormatting(page, 'Motion')
  await range.selectOption('contain')
  await saved()
  expect(await style('c-step', '--lc-range')).toEqual(raw('contain'))
}, 90_000)

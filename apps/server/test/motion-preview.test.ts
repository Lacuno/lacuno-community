import { expect, it } from 'vitest'
import { editor } from './harness.js'

const raw = (value: string) => ({ type: 'raw', value })
const style = (cls: string, property: string, value: unknown) => ({
  type: 'style.set',
  class: cls,
  breakpoint: 'base',
  state: 'none',
  property,
  value,
})
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

it('previews scroll motion and entrances on the canvas and leaves on Escape', async () => {
  const { context, origin, siteId, document, page, canvas } = await editor({
    width: 1400,
    height: 900,
  })
  const apply = async (operations: unknown[]) => {
    const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
      data: { expectedRevision: (await document()).revision, operations },
    })
    expect(response.status()).toBe(200)
  }
  // A three-step story, then a heading that fades in on entering the view.
  await apply([
    ...['c-stage', 'c-step', 'c-rise'].map((id) => ({ type: 'class.create', id, local: true })),
    style('c-stage', 'display', { type: 'keyword', value: 'grid' }),
    style('c-step', '--lc-scroll', raw('lc-fade-through')),
    style('c-rise', '--lc-entrance', raw('lc-fade')),
    style('c-rise', '--lc-duration', raw('60000ms')),
    {
      type: 'node.create',
      parent: 'n-home-main',
      node: {
        id: 'n-story',
        type: 'element',
        tag: 'section',
        classes: [],
        children: [],
        attrs: { 'data-lc-story': { type: 'static', value: true } },
      },
    },
    {
      type: 'node.create',
      parent: 'n-story',
      node: { id: 'n-stage', type: 'element', tag: 'div', classes: ['c-stage'], children: [] },
    },
    text('n-step-1', 'n-stage', 'c-step', 'Light.'),
    text('n-step-2', 'n-stage', 'c-step', 'Fast.'),
    text('n-step-3', 'n-stage', 'c-step', 'Yours.'),
    text('n-rise', 'n-home-main', 'c-rise', 'Hello.'),
  ])
  const root = canvas.locator('html')
  const story = canvas.locator('[data-lacuno-node="n-story"]')
  const step = canvas.locator('[data-lacuno-node="n-step-1"]')
  const rise = canvas.locator('[data-lacuno-node="n-rise"]')
  const overlay = canvas.locator('#lacuno-selection-overlay')
  const opacity = (element: typeof step) =>
    element.evaluate((node) => Number(getComputedStyle(node).opacity))
  await rise.waitFor()

  // Edit mode: everything at rest, nothing follows the scroll.
  await step.scrollIntoViewIfNeeded()
  await step.click()
  await expect.poll(() => step.getAttribute('data-lacuno-selected')).toBe('')
  expect(await opacity(step)).toBe(1)
  expect(await step.evaluate((node) => node.getAnimations().length)).toBe(0)

  const button = page.getByRole('button', { name: 'Preview motion', exact: true })
  await button.click()
  await expect.poll(() => root.getAttribute('data-lacuno-still')).toBeNull()
  expect(await button.getAttribute('aria-pressed')).toBe('true')
  expect(await overlay.evaluate((node) => getComputedStyle(node).display)).toBe('none')
  // Midway through the story the first step has had its turn.
  await story.evaluate((node) => {
    const box = node.getBoundingClientRect()
    node.ownerDocument.defaultView!.scrollBy(0, box.top + box.height / 2)
  })
  await expect.poll(() => step.evaluate((node) => node.getAnimations().length)).toBeGreaterThan(0)
  await expect.poll(() => opacity(step)).toBeLessThan(0.5)
  // A click on the canvas selects nothing.
  await canvas.locator('[data-lacuno-node="n-step-2"]').click({ force: true })
  expect(await step.getAttribute('data-lacuno-selected')).toBe('')
  // An entrance plays once it scrolls into view, and again on an element a morph brings in.
  expect(await rise.getAttribute('data-lc-enter')).toBeNull()
  await rise.scrollIntoViewIfNeeded()
  await expect.poll(() => rise.getAttribute('data-lc-enter')).toBe('')
  await expect.poll(() => opacity(rise)).toBeLessThan(1)
  await apply([text('n-rise-2', 'n-home-main', 'c-rise', 'Again.')])
  const again = canvas.locator('[data-lacuno-node="n-rise-2"]')
  await again.waitFor()
  expect(await root.getAttribute('data-lacuno-still')).toBeNull()
  await again.scrollIntoViewIfNeeded()
  await expect.poll(() => again.getAttribute('data-lc-enter')).toBe('')

  // Escape puts the canvas back at rest with its chrome.
  await page.keyboard.press('Escape')
  await expect.poll(() => root.getAttribute('data-lacuno-still')).toBe('')
  expect(await button.getAttribute('aria-pressed')).toBe('false')
  expect(await rise.getAttribute('data-lc-enter')).toBeNull()
  expect(await opacity(step)).toBe(1)
  expect(await overlay.evaluate((node) => getComputedStyle(node).display)).not.toBe('none')

  // With reduced motion the status line says why nothing moves.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await button.click()
  await expect
    .poll(() => page.locator('.save-state').textContent())
    .toBe('Motion is off: your system prefers reduced motion')
}, 60_000)

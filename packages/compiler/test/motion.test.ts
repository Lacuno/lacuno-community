/// <reference lib="dom" />
import { classNames, generateStylesheet } from '@lacuno/css'
import { type Document, fixtureDocument, type Node, styleKey } from '@lacuno/schema'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { plainImageResolver } from '../src/images.js'
import { assembleDocument, render } from '../src/render.js'

it('marks elements for motion exactly when the motion rules are emitted', () => {
  const doc = fixtureDocument()
  const home = Object.values(doc.pages).find((page) => page.path === '/')!
  const output = () => ({
    body: render(doc, home, undefined, { resolveImage: plainImageResolver }).body,
    css: generateStylesheet(doc).css,
  })
  // The fixture styles `.button:hover` and sets no Motion field: the hover still eases. Without its
  // state styles and its story nothing is marked.
  expect(output().body).toContain('<a class="button primary" data-lacuno-motion=""')
  expect(output().css).toContain(':where([data-lacuno-motion])')
  for (const key of Object.keys(doc.styles))
    if (doc.styles[key]!.state !== 'none' || doc.styles[key]!.property.startsWith('--lc-'))
      delete doc.styles[key]
  delete doc.nodes['n-story']!.attrs
  expect(output().body).not.toContain('data-lacuno-motion')
  expect(output().css).not.toContain('data-lacuno-motion')
})

it('runs entrances once on viewport entry and honors reduced motion in published HTML', async () => {
  const doc = fixtureDocument()
  const id = 'l-hero-title'
  for (const [state, property, value] of [
    ['none', '--lc-entrance', 'lc-slide-up'],
    ['none', '--lc-duration', '1000ms'],
    ['hover', 'scale', '1.2'],
  ] as const) {
    const style = {
      class: id,
      breakpoint: 'base',
      state,
      property,
      value: { type: 'raw' as const, value },
    }
    doc.styles[styleKey(style)] = style
  }
  const result = render(
    doc,
    Object.values(doc.pages).find((page) => page.path === '/')!,
    undefined,
    { resolveImage: plainImageResolver },
  )
  result.head += `<style>${generateStylesheet(doc).css}</style>`
  result.body = `<div style="height:1500px"></div>${result.body}`
  const html = assembleDocument(result)
  expect(html).toContain('IntersectionObserver')
  const canvas = render(
    doc,
    Object.values(doc.pages).find((page) => page.path === '/')!,
    undefined,
    { resolveImage: plainImageResolver, annotateNodes: true },
  )
  expect(canvas.body).not.toContain('IntersectionObserver')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } })
    await page.setContent(html)
    const target = page.locator(`.${classNames(doc).get(id)}`)
    expect(await target.getAttribute('data-lc-enter')).toBeNull()
    await target.scrollIntoViewIfNeeded()
    await expect
      .poll(() => target.evaluate((element) => element.getAnimations().length))
      .toBeGreaterThan(0)
    await target.evaluate((element) => {
      for (const animation of element.getAnimations()) animation.finish()
    })
    await expect.poll(() => target.getAttribute('data-lc-enter')).toBeNull()
    await page.evaluate(() => window.scrollTo(0, 0))
    await target.scrollIntoViewIfNeeded()
    expect(await target.getAttribute('data-lc-enter')).toBeNull()
    await target.hover()
    // Wait for actual animation completion rather than racing the default polling deadline.
    await target.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    await expect
      .poll(() => target.evaluate((element) => getComputedStyle(element).scale))
      .toBe('1.2')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect
      .poll(() => target.evaluate((element) => getComputedStyle(element).transitionDuration))
      .toBe('0s')
    expect(await target.evaluate((element) => element.getAnimations().length)).toBe(0)
    await page.setContent(html)
    await target.scrollIntoViewIfNeeded()
    expect(await target.getAttribute('data-lc-enter')).toBeNull()
    expect(await target.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
    const noScript = await browser.newPage({ javaScriptEnabled: false })
    await noScript.setContent(html)
    expect(await noScript.locator(`.${classNames(doc).get(id)}`).isVisible()).toBe(true)
  } finally {
    await browser.close()
  }
}, 20000)

it('keeps mobile hover overrides out of desktop output', async () => {
  const doc = fixtureDocument()
  const id = 'l-hero-title'
  const mobile = Object.values(doc.breakpoints)
    .filter((bp) => bp.maxWidth !== undefined)
    .sort((a, b) => a.maxWidth! - b.maxWidth!)[0]!
  for (const [breakpoint, state, value] of [
    ['base', 'none', '1.1'],
    [mobile.id, 'hover', '1.2'],
  ] as const) {
    const style = {
      class: id,
      breakpoint,
      state,
      property: 'scale',
      value: { type: 'raw' as const, value },
    }
    doc.styles[styleKey(style)] = style
  }
  const result = render(
    doc,
    Object.values(doc.pages).find((page) => page.path === '/')!,
    undefined,
    { resolveImage: plainImageResolver },
  )
  result.head += `<style>${generateStylesheet(doc).css}</style>`
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    await page.setContent(assembleDocument(result))
    const target = page.locator(`.${classNames(doc).get(id)}`)
    await target.hover()
    await expect
      .poll(() => target.evaluate((element) => getComputedStyle(element).scale))
      .toBe('1.1')
    await page.setViewportSize({ width: 390, height: 800 })
    await target.hover()
    await expect
      .poll(() => target.evaluate((element) => getComputedStyle(element).scale))
      .toBe('1.2')
    await page.setViewportSize({ width: 1100, height: 800 })
    await target.hover()
    await expect
      .poll(() => target.evaluate((element) => getComputedStyle(element).scale))
      .toBe('1.1')
  } finally {
    await browser.close()
  }
}, 20000)

/** Sets a raw style on a class's base breakpoint, or another breakpoint. */
function set(doc: Document, cls: string, property: string, value: string, breakpoint = 'base') {
  const style = {
    class: cls,
    breakpoint,
    state: 'none' as const,
    property,
    value: { type: 'raw' as const, value },
  }
  doc.styles[styleKey(style)] = style
}

const home = (doc: Document) => Object.values(doc.pages).find((page) => page.path === '/')!

it("marks followers and numbers a story's steps in order", () => {
  const doc = fixtureDocument()
  const body = () => render(doc, home(doc), undefined, { resolveImage: plainImageResolver }).body
  const names = classNames(doc)
  expect(body()).toContain('<section data-lc-steps="3" data-lc-story>')
  // The product sets its own range, so it is the pin and not a step.
  expect(body()).toMatch(
    /<img [^>]*class="product" data-lacuno-motion="scroll"(?![^>]*data-lc-step)/,
  )
  for (const n of [1, 2, 3])
    expect(body()).toContain(
      `<h2 class="${names.get('c-step')}" data-lacuno-motion="scroll" data-lc-step="${n}">`,
    )
  // Reordered, the steps number again; a range on a smaller breakpoint keeps a step a step.
  doc.nodes['n-stage']!.children = ['n-product', 'n-step-3', 'n-step-1', 'n-step-2']
  set(doc, 'c-step', '--lc-range', 'cover', 'mobile-p')
  expect(body()).toMatch(/data-lc-step="1">Yours\.<\/h2>.*data-lc-step="2">Light\./)
  // A follower inside a step is no second step, and an instance is never one.
  const step: Node = { ...doc.nodes['n-step-1']!, parent: 'n-step-box' }
  doc.nodes['n-step-1'] = step
  doc.nodes['n-step-box'] = {
    id: 'n-step-box',
    type: 'element',
    tag: 'div',
    parent: 'n-stage',
    children: ['n-step-1'],
    classes: ['c-step'],
  }
  doc.nodes['n-card-step'] = {
    id: 'n-card-step',
    type: 'component',
    component: 'cmp-card',
    parent: 'n-stage',
    children: [],
    classes: ['c-step'],
  }
  doc.nodes['n-stage']!.children = ['n-product', 'n-step-box', 'n-card-step']
  expect(body()).toContain('<section data-lc-steps="1" data-lc-story>')
  expect(body()).toContain('<div class="step" data-lacuno-motion="scroll" data-lc-step="1">')
  expect(body().match(/data-lc-step=/g)).toHaveLength(1)
  expect(generateStylesheet(doc).css).toContain(
    ':where([data-lc-steps="1"] [data-lc-step="1"]) { --lc-range: contain 0% contain 100%; }',
  )
})

/** The fixture's home published below a spacer, its hero's button fading in with the scroll. */
function published() {
  const doc = fixtureDocument()
  set(doc, 'c-button', '--lc-scroll', 'lc-fade')
  const result = render(doc, home(doc), undefined, { resolveImage: plainImageResolver })
  result.head += `<style>${generateStylesheet(doc).css}</style>`
  result.body = `<div style="height:1500px"></div>${result.body}<div style="height:1500px"></div>`
  return assembleDocument(result)
}

const opacity = (page: Page, selector: string) =>
  page.locator(selector).evaluate((element) => Number(getComputedStyle(element).opacity))

/** Scrolls so the element's top is `offset` pixels from the top of the page's first screen. */
const scrollTo = (page: Page, selector: string, offset: number) =>
  page.locator(selector).evaluate((element, offset) => {
    const top = element.getBoundingClientRect().top + window.scrollY
    window.scrollTo(0, top + offset)
  }, offset)

it('follows the scroll and pins a story in published HTML, at rest with reduced motion or on the canvas', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } })
    await page.setContent(published())
    expect(await page.locator('html').getAttribute('data-lacuno-still')).toBeNull()
    const button = 'a.button'
    // A follower runs on a view timeline, from transparent while it enters to opaque.
    expect(
      await page
        .locator(button)
        .evaluate((element) =>
          element.getAnimations().map((animation) => animation.timeline?.constructor.name),
        ),
    ).toEqual(['ViewTimeline'])
    const height = await page
      .locator(button)
      .evaluate((element) => element.getBoundingClientRect().height)
    await scrollTo(page, button, -600 + height / 4)
    await expect.poll(() => opacity(page, button)).toBeLessThan(0.5)
    await scrollTo(page, button, -300)
    await expect.poll(() => opacity(page, button)).toBe(1)

    // Three steps make a story four screens long; its stage stays pinned and the steps take turns.
    const story = '[data-lc-story]'
    expect(
      await page.locator(story).evaluate((element) => element.getBoundingClientRect().height),
    ).toBe(2400)
    await scrollTo(page, story, 900)
    const stage = page.locator('[data-lc-story] > div')
    await expect
      .poll(() => stage.evaluate((element) => element.getBoundingClientRect().top))
      .toBe(0)
    expect(await stage.evaluate((element) => getComputedStyle(element).position)).toBe('sticky')
    await expect.poll(() => opacity(page, '[data-lc-step="2"]')).toBe(1)
    expect(await opacity(page, '[data-lc-step="1"]')).toBe(0)
    expect(await opacity(page, '[data-lc-step="3"]')).toBe(0)
    // The pin has arrived and stays as styled.
    expect(await opacity(page, 'img.product')).toBe(1)

    // Reduced motion and the canvas show everything at rest, the story flowing like any section.
    const atRest = async () => {
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
      expect(await stage.evaluate((element) => getComputedStyle(element).position)).toBe('static')
      const tops = await page
        .locator('[data-lc-step]')
        .evaluateAll((steps) => steps.map((step) => step.getBoundingClientRect().top))
      expect(tops).toEqual([...tops].sort((a, b) => a - b))
      expect(new Set(tops).size).toBe(3)
      for (const n of [1, 2, 3]) expect(await opacity(page, `[data-lc-step="${n}"]`)).toBe(1)
      expect(await opacity(page, button)).toBe(1)
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await atRest()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(5)
    await page.evaluate(() => document.documentElement.setAttribute('data-lacuno-still', ''))
    await atRest()
  } finally {
    await browser.close()
  }
}, 20000)

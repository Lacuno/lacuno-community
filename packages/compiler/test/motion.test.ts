/// <reference lib="dom" />
import { classNames, generateStylesheet } from '@freeflow/css'
import { fixtureDocument, styleKey } from '@freeflow/schema'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { plainImageResolver } from '../src/images.js'
import { assembleDocument, render } from '../src/render.js'

it('runs entrances once on viewport entry and honors reduced motion in published HTML', async () => {
  const doc = fixtureDocument()
  const id = 'l-hero-title'
  for (const [state, property, value] of [
    ['none', '--ff-entrance', 'ff-slide-up'],
    ['none', '--ff-duration', '1000ms'],
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
    expect(await target.getAttribute('data-ff-enter')).toBeNull()
    await target.scrollIntoViewIfNeeded()
    await expect
      .poll(() => target.evaluate((element) => element.getAnimations().length))
      .toBeGreaterThan(0)
    await target.evaluate((element) => {
      for (const animation of element.getAnimations()) animation.finish()
    })
    await expect.poll(() => target.getAttribute('data-ff-enter')).toBeNull()
    await page.evaluate(() => window.scrollTo(0, 0))
    await target.scrollIntoViewIfNeeded()
    expect(await target.getAttribute('data-ff-enter')).toBeNull()
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
    expect(await target.getAttribute('data-ff-enter')).toBeNull()
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

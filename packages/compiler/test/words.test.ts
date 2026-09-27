/// <reference lib="dom" />
import { generateStylesheet } from '@lacuno/css'
import { type Document, fixtureDocument } from '@lacuno/schema'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { plainImageResolver } from '../src/images.js'
import { assembleDocument, render } from '../src/render.js'

/** The hero title as "Build with ‹AI›" whose last word takes turns with "designer" and "you". */
function hero(annotateNodes = false) {
  const doc: Document = fixtureDocument()
  doc.nodes['n-hero-title'] = {
    ...(doc.nodes['n-hero-title'] as Extract<Document['nodes'][string], { type: 'text' }>),
    text: { type: 'static', value: 'AI' },
    rotatingWords: { words: ['designer', 'you'], interval: 1000 },
  }
  const home = Object.values(doc.pages).find((page) => page.path === '/')!
  const result = render(doc, home, undefined, { resolveImage: plainImageResolver, annotateNodes })
  result.head += `<style>${generateStylesheet(doc).css}</style>`
  return result
}

it('publishes the first word in place, the others hidden from assistive tech and read once', () => {
  const { body } = hero()
  expect(body).toContain(
    '<span data-lc-words="3" style="--lc-interval:1000ms"><span>AI</span><span aria-hidden="true">designer</span><span aria-hidden="true">you</span></span><span data-lc-said>, designer, you</span>',
  )
  expect(body).toContain("document.querySelectorAll('[data-lc-words]')")
  // The canvas sandbox runs no scripts; the editor sizes the words itself.
  expect(hero(true).body).not.toContain('<script>')
})

it('cycles the words, sizes the list to the current one and honours reduced motion', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } })
    await page.setContent(assembleDocument(hero()))
    const list = page.locator('[data-lc-words]')
    await expect
      .poll(() => list.evaluate((el) => el.style.getPropertyValue('--lc-w2')))
      .toMatch(/em$/)
    const at = (time: number) =>
      page.evaluate((time) => {
        for (const animation of document.getAnimations()) {
          animation.pause()
          animation.currentTime = time
        }
        const words = Array.from(document.querySelectorAll<HTMLElement>('[data-lc-words] > *'))
        const shown = words.find((word) => getComputedStyle(word).opacity === '1')
        return {
          word: shown?.textContent,
          width: document.querySelector('[data-lc-words]')!.getBoundingClientRect().width,
          widths: words.map((word) => word.getBoundingClientRect().width),
        }
      }, time)
    for (const [time, index] of [
      [500, 0],
      [1500, 1],
      [2500, 2],
      [3500, 0],
    ] as const) {
      const frame = await at(time)
      expect(frame.word).toBe(['AI', 'designer', 'you'][index])
      expect(frame.width).toBeCloseTo(frame.widths[index]!, 0)
    }
    expect(await page.locator('h1').ariaSnapshot()).toBe('- heading "AI , designer, you" [level=1]')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
    expect(await list.innerText()).toBe('AI')
  } finally {
    await browser.close()
  }
})

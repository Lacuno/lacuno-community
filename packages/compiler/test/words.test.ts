/// <reference lib="dom" />
import { generateStylesheet } from '@lacuno/css'
import { type Document, fixtureDocument, type Node } from '@lacuno/schema'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { plainImageResolver } from '../src/images.js'
import { assembleDocument, render } from '../src/render.js'

const text = (id: string, value: string, extra: Partial<Node> = {}): Node =>
  ({
    id,
    type: 'text',
    tag: 'span',
    parent: 'n-hero-title',
    children: [],
    classes: [],
    text: { type: 'static', value },
    ...extra,
  }) as Node

/**
 * The lacuno.io hero: "The website builder your ‹✦ AI› can use too.", where the pill turns to
 * "‹✎ designer›" and then "‹☺ you›" while "your " turns in step and gives way on the third turn.
 */
function hero(interval = 1000, annotateNodes = false) {
  const doc: Document = fixtureDocument()
  const title = doc.nodes['n-hero-title']!
  doc.nodes['n-hero-title'] = {
    ...title,
    type: 'element',
    tag: 'h1',
    children: ['n-lead', 'n-your', 'n-pill', 'n-rest'],
  } as Node
  doc.nodes['n-lead'] = text('n-lead', 'The website builder ')
  doc.nodes['n-your'] = text('n-your', 'your ', {
    rotatingWords: { words: ['your ', ''], interval },
  } as Partial<Node>)
  doc.nodes['n-pill'] = text('n-pill', 'AI', {
    rotatingWords: {
      icon: 'sparkles',
      words: [
        { text: 'designer', icon: 'pen-tool' },
        { text: 'you', icon: 'smile' },
      ],
      interval,
    },
  } as Partial<Node>)
  doc.nodes['n-rest'] = text('n-rest', ' can use too.')
  const home = Object.values(doc.pages).find((page) => page.path === '/')!
  const result = render(doc, home, undefined, { resolveImage: plainImageResolver, annotateNodes })
  result.head += `<style>${generateStylesheet(doc).css}
.pill { display: inline-flex; padding: 0 .3em 0 .24em; border-radius: .5em; background: #eee8ff; }</style>`
  result.body = result.body.replace('<span>AI', '<span class="pill">AI')
  return result
}

it('publishes words with their icons, keeps an empty word and a word in a row as one run', () => {
  const { body } = hero()
  // "your " shows two turns in a row as one element, then nothing; the list is hidden from
  // assistive tech, and only the last of the two texts in step says the phrases.
  expect(body).toContain(
    '<span aria-hidden="true" data-lc-words="3" style="--lc-interval:1000ms"><span data-lc-slots="2">your </span><span data-lc-at="2"></span></span></span>',
  )
  expect(body).toMatch(
    /<span aria-hidden="true" data-lc-words="3" style="--lc-interval:1000ms"><span><svg [^>]*>.*?<\/svg>AI<\/span><span data-lc-at="1"><svg [^>]*>.*?<\/svg>designer<\/span><span data-lc-at="2"><svg [^>]*>.*?<\/svg>you<\/span><\/span><span data-lc-said>your AI, your designer, you<\/span>/,
  )
  // Only the icons in use are in the page.
  expect(body.match(/<svg /g)).toHaveLength(3)
  expect(body).toContain('<circle cx="4" cy="20" r="2"/>') // sparkles
  expect(body).not.toContain('<circle cx="12" cy="7" r="4"/>') // user
  expect(body).toContain('function sizeWords(page')
  // The canvas sandbox runs no scripts; the editor sizes the words itself.
  expect(hero(1000, true).body).not.toContain('<script>')
})

it('reads a single rotating text as its words once', () => {
  const doc: Document = fixtureDocument()
  doc.nodes['n-hero-title'] = {
    ...doc.nodes['n-hero-title'],
    text: { type: 'static', value: 'AI' },
    rotatingWords: { words: ['designer', '', 'you'] },
  } as Node
  const home = Object.values(doc.pages).find((page) => page.path === '/')!
  const { body } = render(doc, home, undefined, { resolveImage: plainImageResolver })
  expect(body).toContain('<span data-lc-said>AI, designer, you</span>')
})

it('turns two texts in step, collapsing "your" on the third turn, and stays in step', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 600 } })
    await page.setContent(assembleDocument(hero(400)))
    const lists = page.locator('[data-lc-words]')
    await expect
      .poll(() => lists.last().evaluate((el) => el.style.getPropertyValue('--lc-w2')))
      .toMatch(/em$/)
    // What shows at a time into the cycle: the visible words, each list's width and its word's.
    const at = (time: number) =>
      page.evaluate((time) => {
        for (const animation of document.getAnimations()) {
          animation.pause()
          animation.currentTime = time
        }
        const lists = Array.from(document.querySelectorAll<HTMLElement>('[data-lc-words]'))
        const shown = lists.map(
          (list) =>
            Array.from(list.children).find(
              (word) => getComputedStyle(word).opacity === '1',
            ) as HTMLElement,
        )
        return {
          text: shown.map((word) => word.textContent).join(''),
          icons: shown[1]!.querySelectorAll('svg').length,
          widths: lists.map((list) => list.getBoundingClientRect().width),
          wordWidths: shown.map((word) => word.getBoundingClientRect().width),
        }
      }, time)
    for (const [turn, phrase] of ['your AI', 'your designer', 'you', 'your AI'].entries()) {
      const frame = await at(400 * turn + 200)
      expect(frame.text).toBe(phrase)
      expect(frame.icons).toBe(1)
      expect(frame.widths[0]).toBeCloseTo(frame.wordWidths[0]!, 0)
      expect(frame.widths[1]).toBeCloseTo(frame.wordWidths[1]!, 0)
    }
    // "your " keeps its trailing space and gives it up with the word: nothing is left over.
    expect((await at(200)).widths[0]).toBeGreaterThan(30)
    expect((await at(1000)).widths[0]).toBe(0)
    // The space belongs to "your ", so the line reads with single spaces in every turn.
    expect(await page.locator('h1').ariaSnapshot()).toBe(
      '- heading "The website builder your AI, your designer, you can use too." [level=1]',
    )

    // Running for real: every word animation starts together and lasts one cycle, so they stay in
    // step for good, also after the page was frozen in the background and resumed.
    await page.setContent(assembleDocument(hero(400)))
    const timings = () =>
      page.evaluate(() =>
        document.getAnimations().map((animation) => ({
          start: animation.startTime,
          duration: animation.effect!.getComputedTiming().duration,
        })),
      )
    await expect.poll(async () => (await timings()).every(({ start }) => start !== null)).toBe(true)
    const session = await page.context().newCDPSession(page)
    await page.waitForTimeout(1300)
    await session.send('Page.setWebLifecycleState', { state: 'frozen' })
    await page.waitForTimeout(500)
    await session.send('Page.setWebLifecycleState', { state: 'active' })
    await page.waitForTimeout(1300)
    const after = await timings()
    expect(after.length).toBe(7)
    expect(new Set(after.map(({ start }) => start)).size).toBe(1)
    expect(new Set(after.map(({ duration }) => duration)).size).toBe(1)
    // And what shows live matches the turn the clock is in, sampled across several cycles.
    for (let sample = 0; sample < 8; sample++) {
      const live = await page.evaluate(() => {
        const [first] = document.getAnimations()
        const elapsed = (document.timeline.currentTime as number) - (first!.startTime as number)
        const into = elapsed % 400
        const text = Array.from(document.querySelectorAll('[data-lc-words]'))
          .map(
            (list) =>
              Array.from(list.children).find((word) => getComputedStyle(word).opacity === '1')
                ?.textContent ?? '',
          )
          .join('')
        return { turn: Math.floor(elapsed / 400) % 3, into, text }
      })
      if (live.into > 60 && live.into < 300)
        expect(live.text).toBe(['your AI', 'your designer', 'you'][live.turn])
      await page.waitForTimeout(170)
    }

    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
    expect(await lists.first().innerText()).toBe('your ')
    expect(await lists.last().innerText()).toBe('AI')
    expect(await lists.last().locator('svg').filter({ visible: true }).count()).toBe(1)
  } finally {
    await browser.close()
  }
}, 30000)

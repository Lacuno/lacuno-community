import {
  type Document,
  plainText,
  type RotatingWords,
  type TextNode,
  type WordIcon,
} from '@lacuno/schema'

/**
 * Rotating words: a text's content and its `rotatingWords` stacked in one grid cell, taking turns
 * through CSS keyframes. Each word shows for `--lc-interval` and hands over in the last 15% of it,
 * sliding up or fading. The list's width follows the current word through `--lc-w<i>`, which
 * `sizeWords` measures; without it the list keeps the widest word's width. Words keep their spaces,
 * so a word ending in one, or an empty word, takes exactly its own room.
 */
const WORDS_CSS = `[data-lc-words] { --lc-interval: 2200ms; display: inline-grid; overflow: clip; }
[data-lc-words] > * { grid-area: 1 / 1; width: max-content; white-space: pre; }
[data-lc-words] svg { display: inline-block; width: 0.8em; height: 0.8em; margin-inline-end: 0.15em; vertical-align: -0.1em; stroke-width: 2.5; }
[data-lc-said] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) {
  [data-lc-words] > :not(:first-child) { display: none; }
}`

const percent = (n: number) => `${Number(n.toFixed(4))}%`

/**
 * Keyframes and timing for lists of `count` words. A word shown `n` turns in a row is one element
 * with its own keyframes, so it stays still instead of handing over to itself; `lengths` are the
 * run lengths the site uses. `data-lc-at` is the turn a word starts on, `data-lc-slots` its length.
 */
function countCss(count: number, lengths: number[]): string {
  const share = 100 / count
  const handover = share * 0.15
  const cycle = `calc(var(--lc-interval) * ${count})`
  const list = `[data-lc-words="${count}"]`
  const widths = Array.from(
    { length: count },
    (_, i) =>
      `${percent(i * share)}, ${percent((i + 1) * share - handover)} { width: var(--lc-w${i}); }`,
  )
  const keyframes = lengths.map((n) => {
    const out = share * n
    return `@keyframes lc-slide-${count}-${n} { 0%, ${percent(out - handover)} { translate: 0; opacity: 1; } ${percent(out)} { translate: 0 -100%; opacity: 0; animation-timing-function: step-end; } ${percent(100 - handover)} { translate: 0 100%; opacity: 0; } }
@keyframes lc-fade-${count}-${n} { 0%, ${percent(out - handover)} { opacity: 1; } ${percent(out)}, ${percent(100 - handover)} { opacity: 0; } }`
  })
  const names = lengths
    .filter((n) => n > 1)
    .map(
      (n) => `  ${list} > [data-lc-slots="${n}"] { animation-name: lc-slide-${count}-${n}; }
  ${list}[data-lc-fade] > [data-lc-slots="${n}"] { animation-name: lc-fade-${count}-${n}; }`,
    )
  const delays = Array.from(
    { length: count - 1 },
    (_, i) =>
      `  ${list} > [data-lc-at="${i + 1}"] { animation-delay: calc(var(--lc-interval) * ${i + 1 - count}); }`,
  )
  return `@keyframes lc-words-${count} { ${widths.join(' ')} 100% { width: var(--lc-w0); } }
${keyframes.join('\n')}
@media (prefers-reduced-motion: no-preference) {
  ${list} { animation: lc-words-${count} ${cycle} infinite; }
  ${list} > * { animation: lc-slide-${count}-1 ${cycle} infinite; }
  ${list}[data-lc-fade] > * { animation-name: lc-fade-${count}-1; }
${[...names, ...delays].join('\n')}
}`
}

/** One element of a rotating list: a word and the turns it shows, `slots` in a row from `at`. */
export type WordTurn = {
  text?: string | undefined
  icon?: WordIcon | undefined
  at: number
  slots: number
}

/**
 * A text's own content, then its rotating words, as turns; equal words in a row make one turn.
 * The content's text is only known, and so only merges, when it is written on the node.
 */
export function wordTurns(node: TextNode, { words, icon }: RotatingWords): WordTurn[] {
  const text = node.text
  const own =
    text.type === 'doc' ? plainText(text) : text.type === 'static' ? String(text.value) : undefined
  const turns: WordTurn[] = []
  for (const [at, word] of [
    { text: own, icon },
    ...words.map((word) => (typeof word === 'string' ? { text: word } : word)),
  ].entries()) {
    const last = turns.at(-1)
    if (last && word.text !== undefined && last.text === word.text && last.icon === word.icon)
      last.slots++
    else turns.push({ ...word, at, slots: 1 })
  }
  return turns
}

/** The rotating-words rules for the word counts and run lengths a document uses, or nothing. */
export function wordsCss(doc: Document): string {
  const counts = new Map<number, Set<number>>()
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'text' || !node.rotatingWords) continue
    const turns = wordTurns(node, node.rotatingWords)
    if (turns.length < 2) continue
    const count = node.rotatingWords.words.length + 1
    const lengths = counts.get(count) ?? new Set()
    for (const turn of turns) lengths.add(turn.slots)
    counts.set(count, lengths)
  }
  if (!counts.size) return ''
  return [
    WORDS_CSS,
    ...[...counts]
      .sort(([a], [b]) => a - b)
      .map(([count, lengths]) =>
        countCss(
          count,
          [...lengths].sort((a, b) => a - b),
        ),
      ),
  ].join('\n')
}

/** What `sizeWords` reads of a page, so this package needs no DOM types. */
type WordList = {
  children: ArrayLike<{
    getBoundingClientRect(): { width: number }
    getAttribute(name: string): string | null
  }>
  style: { setProperty(name: string, value: string): void }
}
type Page = {
  querySelectorAll(selector: string): Iterable<WordList>
  fonts: { ready: Promise<unknown> }
  defaultView: { getComputedStyle(element: WordList): { fontSize: string } } | null
}

/**
 * Measures every word in em for each turn it shows, so a breakpoint's font size keeps it right,
 * now and again once the fonts have loaded. It reads `page` only: published pages run it inline on
 * `document` and the editor runs it against the canvas, whose sandbox allows no scripts of its own.
 * It declares no inner functions, since a bundler may wrap those in helpers the page lacks.
 */
export function sizeWords(page: Page, fontsLoaded = false) {
  for (const list of page.querySelectorAll('[data-lc-words]')) {
    const em = Number.parseFloat(page.defaultView?.getComputedStyle(list).fontSize ?? '16')
    let slot = 0
    for (const word of Array.from(list.children)) {
      const width = `${word.getBoundingClientRect().width / em}em`
      for (let n = Number(word.getAttribute('data-lc-slots') ?? 1); n > 0; n--)
        list.style.setProperty(`--lc-w${slot++}`, width)
    }
  }
  if (!fontsLoaded) page.fonts.ready.then(() => sizeWords(page, true))
}

/** `sizeWords` as an inline script for published pages. */
export const WORDS_SCRIPT = `(${sizeWords})(document);`

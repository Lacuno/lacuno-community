import type { Document } from '@lacuno/schema'

/**
 * Rotating words: a text's content and its `rotatingWords` stacked in one grid cell, taking turns
 * through CSS keyframes. Each word shows for `--lc-interval` and hands over in the last 15% of it,
 * sliding up or fading. The list's width follows the current word through `--lc-w<i>`, which
 * WORDS_SCRIPT measures; without it the list keeps the widest word's width.
 */
const WORDS_CSS = `[data-lc-words] { --lc-interval: 2200ms; display: inline-grid; overflow: clip; }
[data-lc-words] > * { grid-area: 1 / 1; justify-self: start; white-space: nowrap; }
[data-lc-said] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) {
  [data-lc-words] > :not(:first-child) { display: none; }
}`

const percent = (n: number) => `${Number(n.toFixed(4))}%`

/** Keyframes and timing for lists of `count` words; the keyframes depend on the count. */
function countCss(count: number): string {
  const share = 100 / count
  const handover = share * 0.15
  const cycle = `calc(var(--lc-interval) * ${count})`
  const widths = Array.from(
    { length: count },
    (_, i) =>
      `${percent(i * share)}, ${percent((i + 1) * share - handover)} { width: var(--lc-w${i}); }`,
  )
  const delays = Array.from(
    { length: count - 1 },
    (_, i) =>
      `  [data-lc-words="${count}"] > :nth-child(${i + 2}) { animation-delay: calc(var(--lc-interval) * ${i + 1 - count}); }`,
  )
  return `@keyframes lc-words-${count} { ${widths.join(' ')} 100% { width: var(--lc-w0); } }
@keyframes lc-slide-${count} { 0%, ${percent(share - handover)} { translate: 0; opacity: 1; } ${percent(share)} { translate: 0 -100%; opacity: 0; animation-timing-function: step-end; } ${percent(100 - handover)} { translate: 0 100%; opacity: 0; } }
@keyframes lc-fade-${count} { 0%, ${percent(share - handover)} { opacity: 1; } ${percent(share)}, ${percent(100 - handover)} { opacity: 0; } }
@media (prefers-reduced-motion: no-preference) {
  [data-lc-words="${count}"] { animation: lc-words-${count} ${cycle} infinite; }
  [data-lc-words="${count}"] > * { animation: lc-slide-${count} ${cycle} infinite; }
  [data-lc-words="${count}"][data-lc-fade] > * { animation-name: lc-fade-${count}; }
${delays.join('\n')}
}`
}

/** The rotating-words rules for the word counts a document uses, or nothing. */
export function wordsCss(doc: Document): string {
  const counts = new Set<number>()
  for (const node of Object.values(doc.nodes))
    if (node.type === 'text' && node.rotatingWords) counts.add(node.rotatingWords.words.length + 1)
  if (!counts.size) return ''
  return [WORDS_CSS, ...[...counts].sort((a, b) => a - b).map(countCss)].join('\n')
}

/**
 * Measures every word in em, so a breakpoint's font size keeps it right, once now and again when
 * the fonts have loaded. It reads `document` only: published pages run it inline and the editor
 * runs it against the canvas, whose sandbox allows no scripts of its own.
 */
export const WORDS_SCRIPT = `const size = () => {
  for (const list of document.querySelectorAll('[data-lc-words]')) {
    const em = Number.parseFloat(getComputedStyle(list).fontSize);
    [...list.children].forEach((word, i) => list.style.setProperty('--lc-w' + i, word.getBoundingClientRect().width / em + 'em'));
  }
};
size();
document.fonts.ready.then(size);`

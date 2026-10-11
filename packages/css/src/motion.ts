import {
  BASE_BREAKPOINT_ID,
  type Document,
  type Node,
  type NodeId,
  type StyleDecl,
  styleKey,
} from '@lacuno/schema'
import { LIVE_STATES } from './selector.js'
import { percent } from './words.js'

/**
 * A Motion field (`--lc-duration`, `--lc-entrance`, …) or a state a visitor triggers. Either turns
 * on the shared motion rules, so a hover eases instead of snapping, and the compiler marks exactly
 * the classes that carry one. The rules sit in `:where()`, so an authored `transition` still wins.
 */
export const isMotionStyle = (style: StyleDecl): boolean =>
  style.property.startsWith('--lc-') || LIVE_STATES.has(style.state)

/**
 * The animations a class names in `--lc-entrance` (once, on entering the viewport) or `--lc-scroll`
 * (following the scrollbar). `scroll` marks those that only make sense following the scroll;
 * `range` and `timeline` are what such a preset needs beside its name, where the default (`entry`,
 * a turn in a story, `view()`) does not fit. Every preset has the element as styled as one of its
 * frames, so the rest state that edit mode, reduced motion and old browsers show is a real one.
 */
export const MOTION_PRESETS: readonly {
  name: string
  label: string
  scroll?: true
  range?: string
  timeline?: string
  keyframes: string
}[] = [
  { name: 'lc-fade', label: 'Fade in', keyframes: 'from { opacity: 0; }' },
  { name: 'lc-slide-up', label: 'Slide up', keyframes: 'from { opacity: 0; translate: 0 24px; }' },
  {
    name: 'lc-slide-down',
    label: 'Slide down',
    keyframes: 'from { opacity: 0; translate: 0 -24px; }',
  },
  {
    name: 'lc-slide-left',
    label: 'Slide left',
    keyframes: 'from { opacity: 0; translate: 24px 0; }',
  },
  {
    name: 'lc-slide-right',
    label: 'Slide right',
    keyframes: 'from { opacity: 0; translate: -24px 0; }',
  },
  { name: 'lc-scale-up', label: 'Scale up', keyframes: 'from { opacity: 0; scale: .85; }' },
  { name: 'lc-blur-in', label: 'Blur in', keyframes: 'from { opacity: 0; filter: blur(12px); }' },
  {
    name: 'lc-fade-out',
    label: 'Fade out',
    scroll: true,
    range: 'exit',
    keyframes: 'to { opacity: 0; }',
  },
  {
    name: 'lc-parallax',
    label: 'Parallax',
    scroll: true,
    range: 'cover',
    keyframes:
      'from { translate: 0 var(--lc-parallax); } to { translate: 0 calc(-1 * var(--lc-parallax)); }',
  },
  {
    name: 'lc-fade-through',
    label: 'Fade through',
    scroll: true,
    keyframes:
      '0% { opacity: 0; translate: 0 24px; } 25%, 75% { opacity: 1; translate: 0; } 100% { opacity: 0; translate: 0 -24px; }',
  },
  {
    name: 'lc-progress',
    label: 'Reading progress',
    scroll: true,
    range: 'normal',
    timeline: 'scroll()',
    keyframes: 'from { scale: 0 1; }',
  },
]

/** Shared motion rules for published pages and the editor's trusted preview. */
export const MOTION_CSS = `
* { --lc-duration: 400ms; --lc-delay: 0ms; --lc-easing: ease-out; --lc-entrance: none; --lc-scroll: none; --lc-range: entry; --lc-timeline: view(); --lc-parallax: 80px; }
${MOTION_PRESETS.map(({ name, keyframes }) => `@keyframes ${name} { ${keyframes} }`).join('\n')}
@media (prefers-reduced-motion: no-preference) {
  :where([data-lacuno-motion]) {
    transition-property: opacity, scale, rotate, translate, transform, box-shadow, background-color, color, border-color, outline-color;
    transition-duration: var(--lc-duration, 400ms);
    transition-delay: var(--lc-delay, 0ms);
    transition-timing-function: var(--lc-easing, ease-out);
  }
  :where([data-lacuno-motion][data-lc-enter]) {
    animation: var(--lc-entrance, none) var(--lc-duration, 400ms) var(--lc-easing, ease-out) var(--lc-delay, 0ms) both;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-lacuno-motion] { animation: none !important; transition: none !important; }
}
`

/**
 * Scroll-linked motion and stories, only where the browser has scroll timelines, motion is wanted
 * and the page is not the editor's canvas (`data-lacuno-still`); everywhere else every element
 * sits at rest and a story flows like any section. A story pins its first child, the stage, for
 * its whole length, and everything inside follows the story's view timeline. The `animation`
 * shorthand resets the timeline and range, so they follow it. Everything is in `:where()`, so a
 * class's own value wins.
 */
export const SCROLL_CSS = `@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    :where(:root:not([data-lacuno-still]) [data-lc-story]) {
      view-timeline-name: --lc-story;
      min-height: calc(var(--lc-length, calc(var(--lc-steps, 2) + 1)) * 100svh);
    }
    :where(:root:not([data-lacuno-still]) [data-lc-story] > :first-child) { position: sticky; top: 0; height: 100svh; overflow: clip; }
    :where(:root:not([data-lacuno-still]) [data-lc-story] *) { --lc-timeline: --lc-story; --lc-range: contain; }
    :where(:root:not([data-lacuno-still]) [data-lc-step]) { grid-area: 2 / 1; }
    :where(:root:not([data-lacuno-still]) [data-lacuno-motion="scroll"]) {
      animation: var(--lc-scroll) linear both;
      animation-timeline: var(--lc-timeline);
      animation-range: var(--lc-range);
    }
  }
}`

/** A scroll story: an element marked `data-lc-story`. */
export const isStory = (node: Node | undefined): boolean =>
  node?.attrs?.['data-lc-story'] !== undefined

/**
 * A story's steps, in order: the children of its stage (its first child) whose classes follow the
 * scroll on the base breakpoint and set no range of their own there. They take turns through the
 * story; the compiler numbers them and `storyCss` gives each its turn. Instances are not steps.
 */
export function storySteps(doc: Document, story: Node): NodeId[] {
  const stage = doc.nodes[story.children[0] ?? '']
  // A property set on the base breakpoint by one of the node's classes, other than none.
  const sets = (node: Node, property: string) =>
    node.classes.some((c) => {
      const style =
        doc.styles[styleKey({ class: c, breakpoint: BASE_BREAKPOINT_ID, state: 'none', property })]
      return !!style && (style.value as { value?: unknown }).value !== 'none'
    })
  return (stage?.children ?? []).filter((id) => {
    const node = doc.nodes[id]
    return (
      !!node && node.type !== 'component' && sets(node, '--lc-scroll') && !sets(node, '--lc-range')
    )
  })
}

/** Each step's turn, for every step count the document's stories use, or nothing. */
export function storyCss(doc: Document): string {
  const counts = new Set(
    Object.values(doc.nodes)
      .filter(isStory)
      .map((story) => storySteps(doc, story).length)
      .filter((n) => n > 0),
  )
  return [...counts]
    .sort((a, b) => a - b)
    .map((n) =>
      [
        `:where([data-lc-steps="${n}"]) { --lc-steps: ${n}; }`,
        ...Array.from(
          { length: n },
          (_, i) =>
            `:where([data-lc-steps="${n}"] [data-lc-step="${i + 1}"]) { --lc-range: contain ${percent((i * 100) / n)} contain ${percent(((i + 1) * 100) / n)}; }`,
        ),
      ].join('\n'),
    )
    .join('\n')
}

/** What `enterOnView` touches of a page, so this package needs no DOM types. */
type Entering = {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}
type MotionPage = {
  querySelectorAll(selector: string): Iterable<Entering>
  addEventListener(
    type: 'animationend',
    listener: (event: { animationName: string; target: Entering }) => void,
    options: { signal: AbortSignal },
  ): void
  defaultView: {
    matchMedia(query: string): {
      matches: boolean
      addEventListener(type: 'change', listener: () => void, options: { signal: AbortSignal }): void
    }
    getComputedStyle(element: Entering): { getPropertyValue(property: string): string }
  } | null
}
declare const IntersectionObserver: new (
  callback: (entries: { isIntersecting: boolean; target: Entering }[]) => void,
  options: { root: MotionPage },
) => { observe(element: Entering): void; unobserve(element: Entering): void; disconnect(): void }

/**
 * Plays each element's entrance once it comes into view, unless motion is reduced, and returns
 * what stops it and puts every element back at rest. It reads `page` only and watches the page's
 * own viewport (`root: page`): published pages run it inline on `document`, and the editor's
 * Preview runs it from its window against the canvas, whose sandbox allows no scripts of its own.
 * An entrance is over when the animation that ends is the element's own `--lc-entrance`, preset
 * or not. It declares no inner functions, since a bundler may wrap those in helpers the page lacks.
 */
export function enterOnView(page: MotionPage) {
  const view = page.defaultView!
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)')
  const running = new AbortController()
  if (!reduced.matches) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          entry.target.setAttribute('data-lc-enter', '')
        }
      },
      { root: page },
    )
    for (const element of page.querySelectorAll('[data-lacuno-motion]'))
      if (
        !['', 'none'].includes(
          view.getComputedStyle(element).getPropertyValue('--lc-entrance').trim(),
        )
      )
        observer.observe(element)
    page.addEventListener(
      'animationend',
      (event) => {
        if (
          event.animationName ===
          view.getComputedStyle(event.target).getPropertyValue('--lc-entrance').trim()
        )
          event.target.removeAttribute('data-lc-enter')
      },
      { signal: running.signal },
    )
    reduced.addEventListener('change', () => reduced.matches && running.abort(), {
      signal: running.signal,
    })
    running.signal.addEventListener('abort', () => {
      observer.disconnect()
      for (const element of page.querySelectorAll('[data-lc-enter]'))
        element.removeAttribute('data-lc-enter')
    })
  }
  return () => running.abort()
}

/** `enterOnView` as an inline script for published pages; the editor keeps site scripts out. */
export const MOTION_SCRIPT = `(${enterOnView})(document);`

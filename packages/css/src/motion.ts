import type { StyleDecl } from '@lacuno/schema'
import { LIVE_STATES } from './selector.js'

/**
 * A Motion field (`--lc-duration`, `--lc-entrance`, …) or a state a visitor triggers. Either turns
 * on the shared motion rules, so a hover eases instead of snapping, and the compiler marks exactly
 * the classes that carry one. The rules sit in `:where()`, so an authored `transition` still wins.
 */
export const isMotionStyle = (style: StyleDecl): boolean =>
  style.property.startsWith('--lc-') || LIVE_STATES.has(style.state)

/** Shared motion rules for published pages and the editor's trusted preview. */
export const MOTION_CSS = `
* { --lc-duration: 400ms; --lc-delay: 0ms; --lc-easing: ease-out; --lc-entrance: none; }
@keyframes lc-fade { from { opacity: 0; } }
@keyframes lc-slide-up { from { opacity: 0; translate: 0 24px; } }
@keyframes lc-slide-down { from { opacity: 0; translate: 0 -24px; } }
@keyframes lc-slide-left { from { opacity: 0; translate: 24px 0; } }
@keyframes lc-slide-right { from { opacity: 0; translate: -24px 0; } }
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

/** Only our generated observer runs on published pages; the editor keeps site scripts sandboxed. */
export const MOTION_SCRIPT = `(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      if (!preference.matches) entry.target.setAttribute('data-lc-enter', '');
    }
  }, { threshold: 0 });
  for (const element of document.querySelectorAll('[data-lacuno-motion]')) {
    const name = getComputedStyle(element).getPropertyValue('--lc-entrance').trim();
    if (name && name !== 'none') observer.observe(element);
  }
  document.addEventListener('animationend', event => {
    if (event.animationName.startsWith('lc-') && event.target instanceof Element) event.target.removeAttribute('data-lc-enter');
  });
  preference.addEventListener('change', () => {
    if (!preference.matches) return;
    observer.disconnect();
    for (const element of document.querySelectorAll('[data-lc-enter]')) element.removeAttribute('data-lc-enter');
  });
})();`

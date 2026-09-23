import type { StyleDecl } from '@freeflow/schema'
import { LIVE_STATES } from './selector.js'

/**
 * A Motion field (`--ff-duration`, `--ff-entrance`, …) or a state a visitor triggers. Either turns
 * on the shared motion rules, so a hover eases instead of snapping, and the compiler marks exactly
 * the classes that carry one. The rules sit in `:where()`, so an authored `transition` still wins.
 */
export const isMotionStyle = (style: StyleDecl): boolean =>
  style.property.startsWith('--ff-') || LIVE_STATES.has(style.state)

/** Shared motion rules for published pages and the editor's trusted preview. */
export const MOTION_CSS = `
* { --ff-duration: 400ms; --ff-delay: 0ms; --ff-easing: ease-out; --ff-entrance: none; }
@keyframes ff-fade { from { opacity: 0; } }
@keyframes ff-slide-up { from { opacity: 0; translate: 0 24px; } }
@keyframes ff-slide-down { from { opacity: 0; translate: 0 -24px; } }
@keyframes ff-slide-left { from { opacity: 0; translate: 24px 0; } }
@keyframes ff-slide-right { from { opacity: 0; translate: -24px 0; } }
@media (prefers-reduced-motion: no-preference) {
  :where([data-freeflow-motion]) {
    transition-property: opacity, scale, rotate, translate, transform, box-shadow, background-color, color, border-color, outline-color;
    transition-duration: var(--ff-duration, 400ms);
    transition-delay: var(--ff-delay, 0ms);
    transition-timing-function: var(--ff-easing, ease-out);
  }
  :where([data-freeflow-motion][data-ff-enter]) {
    animation: var(--ff-entrance, none) var(--ff-duration, 400ms) var(--ff-easing, ease-out) var(--ff-delay, 0ms) both;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-freeflow-motion] { animation: none !important; transition: none !important; }
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
      if (!preference.matches) entry.target.setAttribute('data-ff-enter', '');
    }
  }, { threshold: 0 });
  for (const element of document.querySelectorAll('[data-freeflow-motion]')) {
    const name = getComputedStyle(element).getPropertyValue('--ff-entrance').trim();
    if (name && name !== 'none') observer.observe(element);
  }
  document.addEventListener('animationend', event => {
    if (event.animationName.startsWith('ff-') && event.target instanceof Element) event.target.removeAttribute('data-ff-enter');
  });
  preference.addEventListener('change', () => {
    if (!preference.matches) return;
    observer.disconnect();
    for (const element of document.querySelectorAll('[data-ff-enter]')) element.removeAttribute('data-ff-enter');
  });
})();`

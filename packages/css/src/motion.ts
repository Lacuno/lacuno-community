import type { StyleDecl } from '@miralo/schema'
import { LIVE_STATES } from './selector.js'

/**
 * A Motion field (`--mi-duration`, `--mi-entrance`, …) or a state a visitor triggers. Either turns
 * on the shared motion rules, so a hover eases instead of snapping, and the compiler marks exactly
 * the classes that carry one. The rules sit in `:where()`, so an authored `transition` still wins.
 */
export const isMotionStyle = (style: StyleDecl): boolean =>
  style.property.startsWith('--mi-') || LIVE_STATES.has(style.state)

/** Shared motion rules for published pages and the editor's trusted preview. */
export const MOTION_CSS = `
* { --mi-duration: 400ms; --mi-delay: 0ms; --mi-easing: ease-out; --mi-entrance: none; }
@keyframes mi-fade { from { opacity: 0; } }
@keyframes mi-slide-up { from { opacity: 0; translate: 0 24px; } }
@keyframes mi-slide-down { from { opacity: 0; translate: 0 -24px; } }
@keyframes mi-slide-left { from { opacity: 0; translate: 24px 0; } }
@keyframes mi-slide-right { from { opacity: 0; translate: -24px 0; } }
@media (prefers-reduced-motion: no-preference) {
  :where([data-miralo-motion]) {
    transition-property: opacity, scale, rotate, translate, transform, box-shadow, background-color, color, border-color, outline-color;
    transition-duration: var(--mi-duration, 400ms);
    transition-delay: var(--mi-delay, 0ms);
    transition-timing-function: var(--mi-easing, ease-out);
  }
  :where([data-miralo-motion][data-mi-enter]) {
    animation: var(--mi-entrance, none) var(--mi-duration, 400ms) var(--mi-easing, ease-out) var(--mi-delay, 0ms) both;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-miralo-motion] { animation: none !important; transition: none !important; }
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
      if (!preference.matches) entry.target.setAttribute('data-mi-enter', '');
    }
  }, { threshold: 0 });
  for (const element of document.querySelectorAll('[data-miralo-motion]')) {
    const name = getComputedStyle(element).getPropertyValue('--mi-entrance').trim();
    if (name && name !== 'none') observer.observe(element);
  }
  document.addEventListener('animationend', event => {
    if (event.animationName.startsWith('mi-') && event.target instanceof Element) event.target.removeAttribute('data-mi-enter');
  });
  preference.addEventListener('change', () => {
    if (!preference.matches) return;
    observer.disconnect();
    for (const element of document.querySelectorAll('[data-mi-enter]')) element.removeAttribute('data-mi-enter');
  });
})();`

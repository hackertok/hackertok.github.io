/**
 * Live read of the user's reduced-motion preference. Call this per action (per
 * click, per gesture) instead of caching the result, so JS-driven motion honors
 * the current OS setting even if it's toggled mid-session — matching how the CSS
 * `prefers-reduced-motion` media query reacts.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

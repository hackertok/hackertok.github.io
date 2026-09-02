/**
 * Let `:active` fire on iOS, where Safari applies it only if a touch handler
 * sits on the element or the document. Without this, press states outside the
 * swipe container never run — and Tailwind's preflight has already zeroed
 * `-webkit-tap-highlight-color`, so nothing else gives feedback on a tap.
 *
 * Passive, so it cannot affect scrolling. Other engines ignore it.
 */
export function enableTouchActiveStates() {
  document.addEventListener('touchstart', () => undefined, { passive: true });
}

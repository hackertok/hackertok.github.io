import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Wait for swipe container to be ready with multiple panels.
 * Verifies container visibility, minimum panel count, and rendered dimensions.
 */
export async function waitForSwipeReady(page: Page, minPanels = 2) {
  const container = page.getByTestId('swipe-container');

  await expect(container).toBeVisible();

  await page.waitForFunction((min) => {
    const panels = document.querySelectorAll('[data-testid="swipe-panel"]');
    return panels.length >= min;
  }, minPanels, { timeout: 5000 });

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="swipe-container"]');
    return el && el.getBoundingClientRect().width > 0;
  }, { timeout: 5000 });
}

/**
 * Scroll the swipe container to a target position and wait for it to settle.
 *
 * Two-phase approach to handle cross-browser scroll-snap quirks:
 *
 * Phase 1 — Temporarily disables CSS scroll-snap and scrolls. This prevents
 * the WebKit snap-back bug (bugs.webkit.org/300086) where the compositor
 * thread reverts a programmatic scrollTo after scrollend has already fired.
 *
 * Phase 2 — Re-enables scroll-snap and verifies the position survives the
 * mandatory re-snap (CSS Scroll Snap spec §4.1.3). Firefox re-snaps
 * synchronously on scroll-snap-type changes; floating-point rounding between
 * getBoundingClientRect and the CSS-computed snap point can cause drift.
 *
 * If position drifts at any point, snap is re-disabled and the scroll retried.
 * Rejects after 5 s if the target position is never reached.
 */
export async function smoothScrollAndAwaitSettled(container: Locator, targetLeft: number) {
  await container.evaluate((el, left) => {
    return new Promise<void>((resolve, reject) => {
      if (Math.abs(el.scrollLeft - left) < 2) {
        resolve();
        return;
      }

      const savedSnap = el.style.scrollSnapType;
      const timeout = setTimeout(() => {
        el.style.scrollSnapType = savedSnap;
        reject(new Error(`Scroll to ${left} timed out (stuck at ${el.scrollLeft})`));
      }, 5000);

      el.style.scrollSnapType = 'none';
      void el.offsetHeight;
      el.scrollTo({ left, behavior: 'instant' });

      let stableFrames = 0;
      let snapRestored = false;

      const poll = () => {
        if (Math.abs(el.scrollLeft - left) < 2) {
          stableFrames++;

          // After 2 stable frames with snap off, re-enable and verify
          if (!snapRestored && stableFrames >= 2) {
            el.style.scrollSnapType = savedSnap;
            void el.offsetHeight; // synchronous re-snap per spec §4.1.3
            snapRestored = true;
          }

          if (stableFrames >= 5) {
            clearTimeout(timeout);
            resolve();
            return;
          }
        } else {
          // Position drifted (WebKit snap-back or Firefox re-snap) — retry
          stableFrames = 0;
          snapRestored = false;
          el.style.scrollSnapType = 'none';
          void el.offsetHeight;
          el.scrollTo({ left, behavior: 'instant' });
        }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    });
  }, targetLeft);
}

/**
 * Wait for the swipe container's scroll position to settle at the expected panel index.
 * Ensures the app has fully processed a goBack/goForward navigation
 * (scroll position updated, React state settled) before proceeding.
 */
export async function waitForScrollAtIndex(page: Page, expectedIndex: number) {
  await page.waitForFunction((idx) => {
    const el = document.querySelector('[data-testid="swipe-container"]');
    if (!el) return false;
    const width = el.getBoundingClientRect().width;
    if (width === 0) return false;
    return Math.round(el.scrollLeft / width) === idx;
  }, expectedIndex, { timeout: 5000 });
}

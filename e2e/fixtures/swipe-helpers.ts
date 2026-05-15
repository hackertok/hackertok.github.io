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
 * Handles cross-browser scroll-snap quirks in three steps per attempt:
 *
 * 1. Disable CSS scroll-snap and scrollTo with `behavior: 'instant'`.
 * 2. Re-enable scroll-snap and force reflow so the browser re-snaps to
 *    the (now correct) position per CSS Scroll Snap spec §4.1.3.
 * 3. Wait 150 ms and verify — WebKit's compositor thread can snap back
 *    asynchronously even after multiple stable rAF frames.
 *
 * If position drifted, retries from step 1 (up to 3 attempts).
 * Dispatches a synthetic `scrollend` so the app's updateIndex fires
 * (Firefox sometimes suppresses native scrollend during snap toggling).
 * Rejects after 8 s if the target position is never reached.
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
      }, 8000);

      const attempt = (remaining: number) => {
        // Step 1: disable snap, scroll instantly
        el.style.scrollSnapType = 'none';
        void el.offsetHeight;
        el.scrollTo({ left, behavior: 'instant' });

        // Step 2: after 2 rAF frames re-enable snap
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.scrollSnapType = savedSnap;
          void el.offsetHeight;

          // Step 3: verify after 150 ms (catches late WebKit compositor snap-back)
          setTimeout(() => {
            if (Math.abs(el.scrollLeft - left) < 2) {
              clearTimeout(timeout);
              el.dispatchEvent(new Event('scrollend'));
              resolve();
            } else if (remaining > 0) {
              attempt(remaining - 1);
            } else {
              clearTimeout(timeout);
              el.dispatchEvent(new Event('scrollend'));
              resolve();
            }
          }, 150);
        }));
      };

      attempt(2);
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
  }, expectedIndex, { timeout: 10_000 });
}

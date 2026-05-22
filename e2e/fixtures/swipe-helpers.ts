import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Wait for swipe container to be ready with multiple panels.
 * Verifies container visibility, minimum panel count, rendered dimensions,
 * and that touch event listeners are attached (data-swipe-enabled).
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

  // Wait for the gesture system to signal readiness (listeners attached).
  // This eliminates the race between panels rendering and useEffect attaching handlers.
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="swipe-container"]');
    return el && (el as HTMLElement).dataset.swipeEnabled === 'true';
  }, { timeout: 5000 });
}

/**
 * Navigate the swipe viewer to a specific panel index by simulating touch
 * gesture events that trigger the hook's native gesture system.
 * Handles multi-step navigation (e.g., index 0 → 2 fires two gestures).
 *
 * @param container - Locator for the swipe-container element
 * @param targetLeft - Pixels. Converted to target index via panel width.
 */
export async function smoothScrollAndAwaitSettled(container: Locator, targetLeft: number) {
  const page = container.page();

  // Determine target index and current index
  const { targetIndex, currentIndex, panelWidth } = await container.evaluate((el, left) => {
    const width = el.getBoundingClientRect().width;
    const target = Math.round(left / width);
    let current = 0;
    for (let i = 0; i < el.children.length; i++) {
      if (el.children[i].classList.contains('active')) {
        current = i;
        break;
      }
    }
    return { targetIndex: target, currentIndex: current, panelWidth: width };
  }, targetLeft);

  if (currentIndex === targetIndex) return;

  const steps = targetIndex > currentIndex
    ? Array.from({ length: targetIndex - currentIndex }, (_, i) => currentIndex + i + 1)
    : Array.from({ length: currentIndex - targetIndex }, (_, i) => currentIndex - i - 1);

  for (const stepTarget of steps) {
    const isForward = stepTarget > (stepTarget === steps[0] ? currentIndex : steps[steps.indexOf(stepTarget) - 1]);

    // Retry loop: handles the rare case where the gesture is dispatched during
    // the ~50ms window when isScrollingProgrammaticallyRef is still true after
    // initial scrollToIndex — the handler silently ignores the touch.
    let success = false;
    for (let attempt = 0; attempt < 3 && !success; attempt++) {
      // Dispatch touch gesture for one step.
      // Uses Event + Object.defineProperty to avoid `new Touch()` / `new TouchEvent()`
      // which throw "Illegal constructor" in WebKit (Safari) and may be unavailable
      // in Firefox desktop even with hasTouch:true.
      await container.evaluate((el, { forward, width }) => {
        const rect = el.getBoundingClientRect();
        const centerX = rect.left + width / 2;
        const centerY = rect.top + rect.height / 2;

        // Swipe distance: 40% of panel width (exceeds the 25% commit threshold)
        const swipeDistance = width * 0.4;
        const endX = forward ? centerX - swipeDistance : centerX + swipeDistance;

        const makeTouch = (clientX: number) => ({
          identifier: 1,
          target: el,
          clientX,
          clientY: centerY,
          pageX: clientX,
          pageY: centerY,
          screenX: clientX,
          screenY: centerY,
          radiusX: 1,
          radiusY: 1,
          rotationAngle: 0,
          force: 1,
        });

        const dispatchTouch = (type: string, touches: object[], changed?: object[]) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'touches', { value: touches });
          Object.defineProperty(event, 'changedTouches', { value: changed ?? touches });
          Object.defineProperty(event, 'targetTouches', { value: touches });
          el.dispatchEvent(event);
        };

        dispatchTouch('touchstart', [makeTouch(centerX)]);
        dispatchTouch('touchmove', [makeTouch(endX)]);
        dispatchTouch('touchend', [], [makeTouch(endX)]);
      }, { forward: isForward, width: panelWidth });

      // Wait for the animation to complete (panel gets .active)
      try {
        await page.waitForFunction((idx) => {
          const c = document.querySelector('[data-testid="swipe-container"]');
          if (!c) return false;
          const panel = c.children[idx] as HTMLElement;
          return panel?.classList.contains('active');
        }, stepTarget, { timeout: 500 });
        success = true;
      } catch {
        // Gesture was likely rejected (e.g. programmatic scroll guard still active).
        // Short wait then retry — by next attempt the guard will have expired.
        await page.waitForTimeout(100);
      }
    }

    if (!success) {
      throw new Error(
        `Swipe to panel index ${stepTarget} failed after 3 attempts. ` +
        `The .active class was not applied to the target panel.`
      );
    }
  }
}

/**
 * Wait for the swipe container's panel at the expected index to have the .active class.
 */
export async function waitForScrollAtIndex(page: Page, expectedIndex: number) {
  await page.waitForFunction((idx) => {
    const container = document.querySelector('[data-testid="swipe-container"]');
    if (!container) return false;
    const panel = container.children[idx] as HTMLElement;
    if (!panel) return false;
    return panel.classList.contains('active');
  }, expectedIndex, { timeout: 10_000 });
}

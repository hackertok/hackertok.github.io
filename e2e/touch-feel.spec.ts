import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { waitForSwipeReady } from './fixtures/swipe-helpers';

// Gesture defences whose real symptoms only appear on a phone — a pull-to-refresh
// that reloads the feed, selection handles eating a drag — and which nothing else
// in the suite would notice disappearing.

const MOBILE = { width: 390, height: 780 };

test.describe('Overscroll containment', () => {
  test.use({ viewport: MOBILE });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('the swipe feed does not chain its overscroll into pull-to-refresh', async ({ page }) => {
    await page.goto('/#/');
    await waitForSwipeReady(page);

    // Swipe mode scrolls the document, so this is the scroller whose overscroll
    // the browser turns into a reload back to the first story.
    const overscrollY = await page.evaluate(
      () => getComputedStyle(document.documentElement).overscrollBehaviorY,
    );

    expect(overscrollY).toBe('contain');
  });

  test('survives the routes that drop swipe mode', async ({ page }) => {
    await page.goto('/#/');
    await waitForSwipeReady(page);

    // `/user/:id` is an ordinary scrollable document, so it strips `swipe-mode`.
    // Reloading it is no cheaper than reloading the feed, so containment cannot
    // be scoped to that class — asserting the class is gone proves it isn't.
    await page.goto('/#/user/pg');

    await expect
      .poll(() =>
        page.evaluate(() => ({
          swipeMode: document.documentElement.classList.contains('swipe-mode'),
          overscrollY: getComputedStyle(document.documentElement).overscrollBehaviorY,
        })),
      )
      .toEqual({ swipeMode: false, overscrollY: 'contain' });
  });
});

test.describe('The gate iOS puts in front of :active', () => {
  test.use({ viewport: MOBILE });

  test('a passive touchstart listener is registered on the document', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Only Chromium can enumerate a target\'s event listeners',
    );

    await setupApiMocks(page);
    await page.goto('/#/');
    await waitForSwipeReady(page);

    // iOS applies `:active` only where a touch handler exists, so this listener
    // is what makes press states outside the swipe container work there. No
    // engine CI can drive shows the effect, so nothing else would catch its loss.
    const cdp = await page.context().newCDPSession(page);
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
      objectId: result.objectId!,
    });

    const touchStarts = listeners.filter((listener) => listener.type === 'touchstart');
    expect(touchStarts.length, 'no touchstart listener on the document').toBeGreaterThan(0);
    // Non-passive would cost the document its scroll fast path for nothing.
    expect(touchStarts.some((listener) => listener.passive)).toBe(true);
  });
});

test.describe('Selection during a horizontal drag', () => {
  test.use({ viewport: MOBILE });

  test('a finger cannot start one on a text post headline, though its body still can', async ({
    page,
    hasTouch,
  }) => {
    test.skip(!hasTouch, 'the lock is gated on a coarse pointer');
    await setupApiMocks(page);
    // The Ask fixture carries `url: null`, so its title renders as bare text
    // instead of a link — the case where a long press raised the handles rather
    // than the link callout, handing the drag to the browser.
    await page.goto('/#/item/88888');
    await waitForSwipeReady(page);

    const panel = page.locator('.swipe-snap-panel.active');
    const prose = panel.locator('.comment-content').first();
    const headline = panel.locator('h1').first();

    // Prove a double-click selects at all here before concluding anything from
    // the headline. Asserting the computed property instead would not travel:
    // Gecko reports the initial `auto` where Blink resolves it against the panel.
    await expect
      .poll(async () => {
        await prose.dblclick();
        return page.evaluate(() => window.getSelection()?.toString().length ?? 0);
      }, { message: 'prose must stay selectable' })
      .toBeGreaterThan(0);

    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await headline.dblclick();
    const fromHeadline = await page.evaluate(() => window.getSelection()?.toString() ?? '');

    expect(fromHeadline, 'the headline must not be selectable').toBe('');
  });

  // The mirror of the test above: same headline, same double-click, opposite
  // expectation. The lock exists to keep a long press off a swipe, and a mouse
  // has no swipe to take, so it must not pay for one.
  test('a mouse keeps that headline selectable', async ({ page, hasTouch }) => {
    test.skip(hasTouch, 'a device with a finger has a gesture to protect');
    await setupApiMocks(page);
    await page.goto('/#/item/88888');
    await waitForSwipeReady(page);

    const headline = page.locator('.swipe-snap-panel.active h1').first();

    await expect
      .poll(async () => {
        await headline.dblclick();
        return page.evaluate(() => window.getSelection()?.toString().length ?? 0);
      }, { message: 'the headline must stay selectable for a mouse' })
      .toBeGreaterThan(0);
  });

  test('a live selection is collapsed when the gesture locks horizontal', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/#/');
    await waitForSwipeReady(page);

    // Prose is the surface that stays selectable, so it is where a long press
    // can leave handles up before a swipe starts. This story is a link post
    // with no body of its own, so its only prose is comments — which arrive
    // after the panel a swipe-ready page waits for.
    await expect(page.locator('.swipe-snap-panel.active .comment-content').first())
      .not.toBeEmpty();

    const startedSelected = await page.evaluate(() => {
      const prose = document.querySelector('.swipe-snap-panel.active .comment-content');
      if (!prose) return false;
      const range = document.createRange();
      range.selectNodeContents(prose);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return !!selection && !selection.isCollapsed;
    });
    expect(startedSelected, 'the fixture must start from a live selection').toBe(true);

    // Assert between touchmove and touchend: a committed swap re-renders the
    // panel, which would clear the selection for the wrong reason.
    const collapsedAtLock = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="swipe-container"]')!;
      const rect = container.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      const startX = rect.left + rect.width / 2;

      const makeTouch = (clientX: number) => ({
        identifier: 1,
        target: container,
        clientX,
        clientY: y,
        pageX: clientX,
        pageY: y,
        screenX: clientX,
        screenY: y,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force: 1,
      });

      // `new TouchEvent()` throws in WebKit, so events are shaped by hand — the
      // same approach swipe-helpers.ts uses.
      const dispatchTouch = (type: string, touches: object[], changed?: object[]) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'touches', { value: touches });
        Object.defineProperty(event, 'changedTouches', { value: changed ?? touches });
        Object.defineProperty(event, 'targetTouches', { value: touches });
        container.dispatchEvent(event);
      };

      dispatchTouch('touchstart', [makeTouch(startX)]);
      // 30px clears the 10px lock threshold with no vertical component.
      dispatchTouch('touchmove', [makeTouch(startX - 30)]);

      const selection = window.getSelection();
      const collapsed = !selection || selection.isCollapsed;

      dispatchTouch('touchend', [], [makeTouch(startX - 30)]);
      return collapsed;
    });

    expect(collapsedAtLock).toBe(true);
  });
});

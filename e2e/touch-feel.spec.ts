import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { waitForSwipeReady } from './fixtures/swipe-helpers';

// Gesture defences whose real symptoms only appear on a phone — a pull-to-refresh
// that reloads the feed, selection handles eating a drag — and which nothing else
// in the suite would notice disappearing.

// A finger as well as a narrow viewport: the swipe viewer asks for both, so a
// narrowed desktop window is a desktop list and has none of this to defend.
const PHONE = { viewport: { width: 390, height: 780 }, hasTouch: true } as const;

test.describe('Overscroll containment', () => {
  test.use(PHONE);

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

    // The class comes off as the profile mounts, so wait for the profile
    // itself: on a loaded runner that mount is the slow part, and a poll over
    // the class alone spends its whole budget waiting for a render it cannot
    // see. That cost a CI run 10.4s here against 2.4s on a quiet machine.
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

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
  test.use(PHONE);

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
  test.use(PHONE);

  test('a finger cannot start one on a text post headline, though its body still can', async ({
    page,
  }) => {
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

// The mirror of the headline test above, and it has to look elsewhere for its
// headline: a mouse reader never reaches a swipe panel now, so the page whose
// selection they could lose is the desktop item page. Nothing there is behind
// the coarse-pointer rules, which is the point — this fails if they escape it.
test.describe('Selection with a mouse', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.skip(({ hasTouch }) => hasTouch, 'a device with a finger has a gesture to protect');

  test('a headline stays selectable on the page a mouse is given', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/#/item/88888');

    const headline = page.getByRole('heading', { level: 1 }).first();
    await expect(headline).toBeVisible();

    await expect
      .poll(async () => {
        await headline.dblclick();
        return page.evaluate(() => window.getSelection()?.toString().length ?? 0);
      }, { message: 'the headline must stay selectable for a mouse' })
      .toBeGreaterThan(0);
  });
});

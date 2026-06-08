import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import {
  expectActiveSwipePanelText,
  getActiveSwipePanel,
  waitForSwipeReady,
  smoothScrollAndAwaitSettled,
  waitForScrollAtIndex,
} from './fixtures/swipe-helpers';

async function getSwipeScrollbarTranslateY(page: Parameters<typeof test>[0]['page']) {
  return page.evaluate(() => {
    const transform = getComputedStyle(document.body, '::after').transform;

    if (!transform || transform === 'none') {
      return 0;
    }

    const match = transform.match(/^matrix(3d)?\((.+)\)$/);
    if (!match) {
      return 0;
    }

    const values = match[2]
      .split(',')
      .map((value) => Number.parseFloat(value.trim()));

    return match[1] === '3d'
      ? (values[13] ?? 0)
      : (values[5] ?? 0);
  });
}

test.describe('Mobile Swipe Viewer', () => {
  test.use({
    viewport: { width: 375, height: 667 },
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('shows swipe viewer with item on mobile', async ({ page }) => {
    await page.goto('/#/');

    const swipeContainer = page.getByTestId('swipe-container');
    await expect(swipeContainer).toBeVisible();

    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');
  });

  test('can swipe to next item', async ({ page }) => {
    await page.goto('/#/');

    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');

    await expect(page).toHaveTitle(/Rust Is the Future.*HackerTok/);

    const container = page.getByTestId('swipe-container');

    // Wait for pagination panels (stories.length < 10 auto-load) so
    // DOM mutations from appending stories don't overlap with the scroll
    // (Firefox re-snaps on snap-child changes during scroll-settle).
    await waitForSwipeReady(page, 6);

    // getBoundingClientRect is more reliable than clientWidth (handles zoom).
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Smooth scroll → scrollend event → app URL update.
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

    await expect(page).toHaveTitle(/SQLite Does Not Do Full FSYNC.*HackerTok/);
  });

  test('panels fill viewport width', async ({ page }) => {
    await page.goto('/#/');

    const panel = page.getByTestId('swipe-panel').first();
    await expect(panel).toBeVisible();

    const viewportWidth = page.viewportSize()?.width || 375;
    const minExpectedWidth = viewportWidth * 0.95;

    // Combined wait + measurement avoids a race where the panel renders
    // before its width has settled.
    const panelWidth = await page.waitForFunction(
      (minWidth) => {
        const el = document.querySelector('[data-testid="swipe-panel"]');
        if (!el) return null;
        const width = el.getBoundingClientRect().width;
        return width >= minWidth ? width : null;
      },
      minExpectedWidth,
      { timeout: 5000 }
    ).then(handle => handle.jsonValue());

    // 95%, not 100%, to tolerate minor padding/scrollbar variation.
    expect(panelWidth).toBeGreaterThanOrEqual(minExpectedWidth);
  });

  test('can scroll vertically within item', async ({ page }) => {
    await page.goto('/#/');

    await expect(page.getByTestId('swipe-panel').first()).toBeVisible();

    // In document-level scroll mode, the page itself scrolls (no overflow-y:auto on panel).
    // Verify document is scrollable by checking the active panel has min-height > viewport.
    await expect(async () => {
      const isScrollable = await page.evaluate(() => {
        return document.documentElement.scrollHeight > window.innerHeight;
      });
      expect(isScrollable).toBe(true);
    }).toPass();
  });

  test('custom swipe scrollbar moves when document scrolls', async ({ page }) => {
    await page.goto('/#/');

    await waitForSwipeReady(page, 6);
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });

    // Guarantee a tall active panel so the document can scroll on every browser.
    await page.evaluate(() => {
      const activePanel = document.querySelector('[data-testid="swipe-panel"].active');
      if (activePanel) {
        (activePanel as HTMLElement).style.minHeight = `${window.innerHeight + 1200}px`;
      }
    });

    await expect(async () => {
      const isScrollable = await page.evaluate(() => {
        return document.documentElement.scrollHeight > window.innerHeight;
      });
      expect(isScrollable).toBe(true);
    }).toPass();

    const initialTranslateY = await getSwipeScrollbarTranslateY(page);

    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });

    await expect.poll(
      () => page.evaluate(() => window.scrollY),
      { timeout: 5000 },
    ).toBeGreaterThanOrEqual(250);

    await expect.poll(
      () => getSwipeScrollbarTranslateY(page),
      { timeout: 5000 },
    ).toBeGreaterThan(initialTranslateY + 5);

    const scrolledTranslateY = await getSwipeScrollbarTranslateY(page);

    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    await expect.poll(
      () => page.evaluate(() => window.scrollY),
      { timeout: 5000 },
    ).toBe(0);

    await expect.poll(
      () => getSwipeScrollbarTranslateY(page),
      { timeout: 5000 },
    ).toBeLessThan(scrolledTranslateY - 5);
  });

  test('custom swipe scrollbar updates when active panel height grows without scrolling', async ({ page }) => {
    await page.goto('/#/');

    await waitForSwipeReady(page, 6);
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });

    await page.evaluate(() => {
      const activePanel = document.querySelector('[data-testid="swipe-panel"].active');
      if (activePanel) {
        (activePanel as HTMLElement).style.minHeight = `${window.innerHeight + 1200}px`;
      }
    });

    await expect(async () => {
      const isScrollable = await page.evaluate(() => {
        return document.documentElement.scrollHeight > window.innerHeight;
      });
      expect(isScrollable).toBe(true);
    }).toPass();

    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });

    await expect.poll(
      () => page.evaluate(() => window.scrollY),
      { timeout: 5000 },
    ).toBeGreaterThanOrEqual(250);

    await expect.poll(
      () => getSwipeScrollbarTranslateY(page),
      { timeout: 5000 },
    ).toBeGreaterThan(5);

    const beforeHeightGrowth = {
      scrollHeight: await page.evaluate(() => document.documentElement.scrollHeight),
      translateY: await getSwipeScrollbarTranslateY(page),
    };

    await page.evaluate(() => {
      const activePanel = document.querySelector('[data-testid="swipe-panel"].active');
      if (activePanel) {
        (activePanel as HTMLElement).style.minHeight = `${window.innerHeight + 2400}px`;
      }
    });

    await expect.poll(
      () => page.evaluate(() => document.documentElement.scrollHeight),
      { timeout: 5000 },
    ).toBeGreaterThan(beforeHeightGrowth.scrollHeight + 500);

    await expect.poll(
      () => getSwipeScrollbarTranslateY(page),
      { timeout: 5000 },
    ).toBeLessThan(beforeHeightGrowth.translateY - 5);
  });

  test('custom swipe scrollbar updates after swiping to a new active panel', async ({ page }) => {
    await page.goto('/#/');

    await waitForSwipeReady(page, 6);
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });

    const container = page.getByTestId('swipe-container');
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

    await page.evaluate(() => {
      const activePanel = document.querySelector('[data-testid="swipe-panel"].active');
      if (activePanel) {
        (activePanel as HTMLElement).style.minHeight = `${window.innerHeight + 1200}px`;
      }
    });

    await expect(async () => {
      const isScrollable = await page.evaluate(() => {
        return document.documentElement.scrollHeight > window.innerHeight;
      });
      expect(isScrollable).toBe(true);
    }).toPass();

    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });

    await expect.poll(
      () => page.evaluate(() => window.scrollY),
      { timeout: 5000 },
    ).toBeGreaterThanOrEqual(250);

    await expect.poll(
      () => getSwipeScrollbarTranslateY(page),
      { timeout: 5000 },
    ).toBeGreaterThan(5);

    const beforeHeightGrowth = {
      scrollHeight: await page.evaluate(() => document.documentElement.scrollHeight),
      translateY: await getSwipeScrollbarTranslateY(page),
    };

    await page.evaluate(() => {
      const activePanel = document.querySelector('[data-testid="swipe-panel"].active');
      if (activePanel) {
        (activePanel as HTMLElement).style.minHeight = `${window.innerHeight + 2400}px`;
      }
    });

    await expect.poll(
      () => page.evaluate(() => document.documentElement.scrollHeight),
      { timeout: 5000 },
    ).toBeGreaterThan(beforeHeightGrowth.scrollHeight + 500);

    await expect.poll(
      () => getSwipeScrollbarTranslateY(page),
      { timeout: 5000 },
    ).toBeLessThan(beforeHeightGrowth.translateY - 5);
  });

  test('preserves expanded replies when swiping away and back', async ({ page }) => {
    await page.goto('/#/');

    await waitForSwipeReady(page, 6);
    await expect(page).toHaveURL(/\/item\//, { timeout: 5000 });

    const activePanel = getActiveSwipePanel(page);
    await activePanel.getByRole('button', { name: /1 reply|\d+ replies/i }).first().click();

    // Wait for reply content to appear
    const replyContent = activePanel.locator('.tree-trunk > .tree-branch .comment-content').first();
    await expect(replyContent).toBeVisible({ timeout: 5000 });

    // Swipe forward to next panel
    const container = page.getByTestId('swipe-container');
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\//, { timeout: 5000 });

    // Swipe back to original panel
    await smoothScrollAndAwaitSettled(container, 0);
    await waitForScrollAtIndex(page, 0);

    // Replies should still be expanded and visible
    await expect(replyContent).toBeVisible({ timeout: 5000 });
  });

  test('preserves scroll position when swiping away and back', async ({ page }) => {
    await page.goto('/#/');

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 6);
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });

    // Force the active panel to be taller than the viewport so the document is
    // scrollable regardless of content length or device viewport height.
    await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="swipe-panel"].active');
      if (panel) (panel as HTMLElement).style.minHeight = `${window.innerHeight + 400}px`;
    });

    // Scroll down within panel 0
    await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'instant' }));
    await expect.poll(
      () => page.evaluate(() => window.scrollY),
    ).toBeGreaterThanOrEqual(150);

    // Swipe forward to panel 1
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);

    // Panel 1 starts at top
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);

    // Swipe back to panel 0
    await smoothScrollAndAwaitSettled(container, 0);
    await waitForScrollAtIndex(page, 0);

    // Panel 0's scroll position should be restored
    await expect.poll(
      () => page.evaluate(() => window.scrollY),
      { timeout: 5000 },
    ).toBeGreaterThanOrEqual(150);
  });

  test('swipe back to previous item', async ({ page }) => {
    await page.goto('/#/');

    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();
    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');
    // Initial / → /item/12345 redirect must settle before scripted swipes.
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });

    // Wait for pagination panels (stories.length < 10 auto-load) so
    // DOM mutations from appending stories don't overlap with the scroll
    // (Firefox re-snaps on snap-child changes during scroll-settle).
    await waitForSwipeReady(page, 6);

    const width = await container.evaluate((el) => el.getBoundingClientRect().width);

    await smoothScrollAndAwaitSettled(container, width);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

    await smoothScrollAndAwaitSettled(container, 0);
    await waitForScrollAtIndex(page, 0);
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });
  });

  test('swipe uses replace — back navigates to previous section, not previous item', async ({ page }) => {
    // Swipe-driven URL changes use replaceState (not pushState), so back
    // exits the swipe viewer rather than stepping through items.
    await page.goto('/#/');

    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');
    // Wait for / → /item/12345 to settle so React's scroll-init cycle
    // and the programmatic-scroll flag have cleared before we swipe.
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });
    const container = page.getByTestId('swipe-container');
    // Wait for pagination panels (stories.length < 10 auto-load) so
    // DOM mutations from appending stories don't overlap with the scroll
    // (Firefox re-snaps on snap-child changes during scroll-settle).
    await waitForSwipeReady(page, 6);
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);

    await smoothScrollAndAwaitSettled(container, width);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

    await smoothScrollAndAwaitSettled(container, width * 2);
    await waitForScrollAtIndex(page, 2);
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });

    // goto creates 1 history entry; replaces keep it there. >1 means we leaked entries.
    const historyLength = await page.evaluate(() => window.history.length);
    expect(historyLength).toBeLessThanOrEqual(2);
  });
});

test.describe('Mobile Direct Item Access', () => {
  test.use({ 
    viewport: { width: 375, height: 667 },
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('can access item directly via URL on mobile', async ({ page }) => {
    await page.goto('/#/item/12345');

    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');
  });

  test('displays Ask HN body text in mobile swipe view', async ({ page }) => {
    // Navigate to Ask HN item (88888 - has text content but no URL)
    // On mobile this renders via FullScreenItem.jsx, not ItemDetail.jsx
    await page.goto('/#/item/88888');

    // Should display the Ask HN title
    await expectActiveSwipePanelText(page, 'Ask HN: What are you working on?');

    // Should display the item body text (sanitized HTML rendered in FullScreenItem)
    await expect(page.getByText(/curious what side projects everyone is working on/i)).toBeVisible();
  });

  test('clears error state when navigating back and forward from not-found item', async ({ page }) => {
    // Regression test: navigating to a non-existent item sets anchorItemId,
    // injectedError, and fetchedItemIdRef. Browser back/forward must properly
    // clear and re-fetch so the correct UI renders at each step.

    // Start at a valid item (creates browser history entry)
    await page.goto('/#/item/12345');
    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');

    // Navigate to a non-existent item via client-side hash change
    await page.evaluate(() => window.location.hash = '#/item/99999999');
    await expect(page.getByText(/not found/i)).toBeVisible();
    // Document title should reflect the error, not stale item title
    await expect(page).toHaveTitle(/Item not found.*HackerTok/);

    // Press browser back — valid item should render
    await page.goBack();
    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');
    await expect(page.getByText(/not found/i)).not.toBeVisible();
    await expect(page).toHaveTitle(/Rust Is the Future of JavaScript Infrastructure.*HackerTok/);

    // Press browser forward — should re-fetch and show error again (not skeleton)
    await page.goForward();
    await expect(page.getByText(/not found/i)).toBeVisible();
  });

  test('restores swipe position when navigating back from not-found item', async ({ page }) => {
    // Regression: swiping away from index 0, then navigating to a non-existent item,
    // then pressing back should restore the scroll position (not reset to index 0).

    await page.goto('/#/');
    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');

    const container = page.getByTestId('swipe-container');
    // Wait for pagination panels (stories.length < 10 auto-load) so
    // DOM mutations from appending stories don't overlap with the scroll
    // (Firefox re-snaps on snap-child changes during scroll-settle).
    await waitForSwipeReady(page, 6);
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to index 1 (item 12346 — "SQLite Does Not Do Full FSYNC by Default")
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);

    // Navigate to non-existent item
    await page.evaluate(() => window.location.hash = '#/item/99999999');
    await expect(page.getByText(/not found/i)).toBeVisible();

    // Press browser back — should restore to item 12346, not index 0 (12345)
    await page.goBack();
    await expect(page.getByText(/not found/i)).not.toBeVisible();
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });
    await waitForScrollAtIndex(page, 1);
    await expectActiveSwipePanelText(page, 'SQLite Does Not Do Full FSYNC by Default', { minPanels: 6 });

    // Verify scroll position is actually at index 1 (not just that element exists in DOM).
    // Use expect.poll to tolerate brief state transitions after goBack.
    await expect.poll(() => container.evaluate(
      (el) => {
        const panels = el.children;
        for (let i = 0; i < panels.length; i++) {
          if (panels[i].classList.contains('active')) return i;
        }
        return -1;
      }
    ), { timeout: 5000 }).toBe(1);
  });

  test('restores swipe position at last index after back from not-found item', async ({ page }) => {
    // Regression: swiping to the LAST item (index 2), then navigating to a
    // non-existent item, then pressing back should restore scroll to index 2.

    await page.goto('/#/');
    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');

    const container = page.getByTestId('swipe-container');
    // Wait for pagination panels (stories.length < 10 auto-load) so
    // DOM mutations from appending stories don't overlap with the scroll
    // (Firefox re-snaps on snap-child changes during scroll-settle).
    await waitForSwipeReady(page, 6);
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to index 1, then index 2 (item 12347 — "Why We Moved from React to htmx")
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await smoothScrollAndAwaitSettled(container, panelWidth * 2);
    await waitForScrollAtIndex(page, 2);

    // Navigate to non-existent item
    await page.evaluate(() => window.location.hash = '#/item/99999999');
    await expect(page.getByText(/not found/i)).toBeVisible();

    // Press browser back — should restore to item 12347 at index 2
    await page.goBack();
    await expect(page.getByText(/not found/i)).not.toBeVisible();
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });
    await waitForScrollAtIndex(page, 2);
    await expectActiveSwipePanelText(page, 'Why We Moved from React to htmx', { minPanels: 6 });

    // Verify scroll position is actually at index 2 (not just that element exists in DOM).
    // Use expect.poll to tolerate brief state transitions after goBack.
    await expect.poll(() => container.evaluate(
      (el) => {
        const panels = el.children;
        for (let i = 0; i < panels.length; i++) {
          if (panels[i].classList.contains('active')) return i;
        }
        return -1;
      }
    ), { timeout: 5000 }).toBe(2);
  });

  test('back from best section shows top items, not best items', async ({ page }) => {
    // Start on home (top items)
    await page.goto('/#/');
    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');

    const container = page.getByTestId('swipe-container');
    // Wait for pagination panels (stories.length < 10 auto-load) so
    // DOM mutations from appending stories don't overlap with the scroll
    // (Firefox re-snaps on snap-child changes during scroll-settle).
    await waitForSwipeReady(page, 6);
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to index 1 so we have a non-trivial position
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);

    // Navigate to best section via header
    const bestLink = page.getByRole('link', { name: /best/i });
    await bestLink.click({ force: true });

    // Should show best items (distinct from top items)
    await expect(page).toHaveURL(/\/item\/33001/, { timeout: 5000 });
    await expect(page.getByText('The Art of Finishing Projects').first()).toBeVisible({ timeout: 5000 });

    // Press browser back — should return to top items
    await page.goBack();
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });
    // Should show a top item in the active panel. After back-nav, the swipe viewer
    // restores to the previous index (1 = SQLite story).
    await waitForScrollAtIndex(page, 1);
    const activePanel = getActiveSwipePanel(page);
    await expect(activePanel.getByText('SQLite Does Not Do Full FSYNC by Default')).toBeVisible({ timeout: 5000 });
    await expect(activePanel.getByText('The Art of Finishing Projects')).toHaveCount(0);
  });

  test('loads more items when swiping near the end', async ({ page }) => {
    // The swipe viewer triggers loadMore() when within 5 items of the end
    // or when fewer than 10 items are loaded. With only 3 top items in
    // the initial batch, it should auto-load pagination items.

    await page.goto('/#/');
    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');

    const container = page.getByTestId('swipe-container');

    // The auto-load fires immediately (stories.length < 10) at index 0,
    // adding pagination items before any swipe. Wait for those panels so
    // DOM mutations from appending stories don't overlap with the scroll
    // (Firefox re-snaps on snap-child changes during scroll-settle).
    await waitForSwipeReady(page, 6);

    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to the last item in the initial batch
    await smoothScrollAndAwaitSettled(container, panelWidth * 2);

    // Use expect.poll to tolerate brief state transitions
    // from loading-panel toggles at the tail of the container.
    await expect.poll(() => container.evaluate(
      (el) => {
        const panels = el.children;
        for (let i = 0; i < panels.length; i++) {
          if (panels[i].classList.contains('active')) return i;
        }
        return -1;
      }
    ), { timeout: 10000 }).toBe(2);

    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });

    // The total panel count should be more than the initial 3
    const panelCount = await page.locator('[data-testid="swipe-panel"]').count();
    expect(panelCount).toBeGreaterThan(3);
  });

  test('displays Ask HN body text when swiping through feed (Algolia story_text)', async ({ page }) => {
    // Regression: stories loaded from Algolia search (used by /ask, /show, /)
    // carry body text in the `story_text` field. normalizeAlgoliaHit must map
    // it to `text` so FullScreenItem can render it. Previously, this field was
    // dropped, causing body text to be missing on mobile (but not desktop,
    // which always re-fetches from Firebase).

    await page.goto('/#/ask');

    // The /ask route auto-navigates to /item/<first-story> once stories load,
    // which remounts SwipeStoryViewer. Wait for that transition to complete so
    // we scroll the final instance (not the transient one from /ask).
    await expect(page).toHaveURL(/\/item\/\d+/);

    await waitForSwipeReady(page, 2);

    // Mock Ask HN items sorted by gravity: item1 (88888, has story_text) ranks
    // first (higher score), item2 (88887, no text) is second. The body text
    // should be visible at index 0 without swiping.

    // The body text should be visible — this comes from Algolia's story_text
    // field, NOT from a Firebase re-fetch (which is the point of the test).
    await expect(page.getByText(/curious what side projects everyone is working on/i)).toBeVisible();
  });

  test('navigating directly to a comment shows comment in swipe viewer', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Comment author renders inside the swipe viewer — not the "not a story" guard.
    await expectActiveSwipePanelText(page, 'patio11', { timeout: 10000 });

    await expect(page).toHaveURL(/\/item\/1001/);
  });

  test('shows not-available message for job items', async ({ page }) => {
    // Job items (type: 'job') are not stories — SwipeStoryViewer shows an error.
    // Flow: MobileItemResolver fetches item → type is 'job' (not 'comment') →
    // renders SwipeStoryViewer → it fetches again → detects type === 'job' →
    // sets injectedError('job') → renders error UI.
    await page.goto('/#/item/55555');

    await expect(page.getByText('This item is not a story')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /back to home/i })).toBeVisible();
    await expect(page).toHaveTitle(/Item not available.*HackerTok/);
  });

  test('restores swipe position on the main feed after a full page reload', async ({ page }) => {
    // The headline bfcache-miss scenario: swipe deep, then a FULL reload (in-memory
    // feed state AND location.state are gone). The durable sessionStorage snapshot
    // must restore the story at its prior index instead of collapsing it to 0.
    // (Distinct from the goBack tests above, which keep the SPA — and its state —
    // alive.) This describe's beforeEach does not clear storage, so the snapshot
    // survives the reload.
    await page.goto('/#/');
    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 6);
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to index 2 (item 12347 — "Why We Moved from React to htmx").
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await smoothScrollAndAwaitSettled(container, panelWidth * 2);
    await waitForScrollAtIndex(page, 2);
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });

    // Force the hide-time persist deterministically (pagehide's handler writes the
    // snapshot unconditionally), and confirm it landed before reloading.
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('__swipe_pos')))
      .not.toBeNull();

    await page.reload();

    // After reload: no location.state, feed rebuilt from cache, snapshot restores
    // index 2 — NOT index 0 (the bug).
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });
    await waitForScrollAtIndex(page, 2);
    await expectActiveSwipePanelText(page, 'Why We Moved from React to htmx', { minPanels: 3 });

    await expect.poll(() => container.evaluate(
      (el) => {
        const panels = el.children;
        for (let i = 0; i < panels.length; i++) {
          if (panels[i].classList.contains('active')) return i;
        }
        return -1;
      }
    ), { timeout: 5000 }).toBe(2);
  });

  test('restores a domain feed after reload (recovers the whole feed, not one item)', async ({ page }) => {
    // Domain feeds use a non-persisted in-memory cache, so a reload wipes the live
    // list entirely. Without snapshot-driven viewer recovery the resolver would
    // show only the single resolved item; Branch 4b must rebuild the domain viewer
    // and restore the prior index with its neighbors.
    await page.goto('/#/from/example.com');

    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();
    // Mobile domain viewer replaces /#/from/:domain with /#/item/77777 (mockDomainItem).
    await expect(page).toHaveURL(/\/item\/77777/, { timeout: 5000 });
    await waitForSwipeReady(page, 2);

    // Swipe to index 1 (first clone — objectID 77770).
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/77770/, { timeout: 5000 });

    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('__swipe_pos')))
      .not.toBeNull();

    await page.reload();

    // After reload the domain cache is empty and location.state is gone, but the
    // snapshot recovers the domain viewer (Branch 4b) and restores index 1 with the
    // full neighborhood (more than one panel — not collapsed to a single item).
    await expect(page).toHaveURL(/\/item\/77770/, { timeout: 5000 });
    await waitForScrollAtIndex(page, 1);

    const panelCount = await page.locator('[data-testid="swipe-panel"]').count();
    expect(panelCount).toBeGreaterThan(1);

    await expect.poll(() => container.evaluate(
      (el) => {
        const panels = el.children;
        for (let i = 0; i < panels.length; i++) {
          if (panels[i].classList.contains('active')) return i;
        }
        return -1;
      }
    ), { timeout: 5000 }).toBe(1);
  });
});

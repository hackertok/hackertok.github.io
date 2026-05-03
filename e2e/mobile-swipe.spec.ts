import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { waitForSwipeReady, smoothScrollAndAwaitSettled, waitForScrollAtIndex } from './fixtures/swipe-helpers';

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

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('can swipe to next item', async ({ page }) => {
    await page.goto('/#/');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await expect(page).toHaveTitle(/Rust Is the Future.*HackerTok/);

    const container = page.getByTestId('swipe-container');

    // Need at least 2 panels mounted before scroll-snap has a target.
    await waitForSwipeReady(page, 2);

    // getBoundingClientRect is more reliable than clientWidth (handles zoom).
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Smooth scroll → scrollend event → app URL update.
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

    await expect(page).toHaveTitle(/SQLite Does Not Do Full FSYNC.*HackerTok/);
  });

  test('scroll-snap behavior works correctly', async ({ page }) => {
    // Behavior test (not a CSS property assertion): drop scroll between snap
    // points and verify CSS scroll-snap: mandatory pulls it to a boundary.
    await page.goto('/#/');

    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();

    await expect(page.getByTestId('swipe-panel').first()).toBeVisible();

    await waitForSwipeReady(page, 2);

    const panelWidth = await container.evaluate(el => el.getBoundingClientRect().width);

    // Drop scroll position halfway between snap points; mandatory snap should pull it back.
    await container.evaluate((el, width) => {
      el.scrollLeft = width * 0.5;
    }, panelWidth);

    // Poll until the scroll position settles on a boundary; CSS snap is async.
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="swipe-container"]');
      if (!el) return false;
      const scrollLeft = el.scrollLeft;
      const width = el.getBoundingClientRect().width;
      return scrollLeft < 10 || Math.abs(scrollLeft - width) < 10;
    }, { timeout: 5000 });

    const finalScrollLeft = await container.evaluate(el => el.scrollLeft);

    // 10px tolerance for sub-pixel rendering differences across browsers.
    const snappedToStart = finalScrollLeft < 10;
    const snappedToPanel = Math.abs(finalScrollLeft - panelWidth) < 10;

    expect(snappedToStart || snappedToPanel).toBe(true);
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

    const panel = page.getByTestId('swipe-panel').first();

    // SwipeItemViewer panels use overflow-y: auto so long content scrolls
    // inside a panel rather than spilling. toPass retries until CSS lands —
    // computed style briefly returns "" while stylesheets are still loading.
    await expect(async () => {
      const overflowY = await panel.evaluate((el) => {
        return window.getComputedStyle(el).overflowY;
      });
      expect(['auto', 'scroll']).toContain(overflowY);
    }).toPass();
  });

  test('swipe back to previous item', async ({ page }) => {
    await page.goto('/#/');

    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    // Initial / → /item/12345 redirect must settle before scripted swipes.
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });

    await waitForSwipeReady(page, 2);

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

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    // Wait for / → /item/12345 to settle so React's scroll-init cycle
    // and the programmatic-scroll flag have cleared before we swipe.
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });
    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 3);
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

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('displays Ask HN body text in mobile swipe view', async ({ page }) => {
    // Navigate to Ask HN item (88888 - has text content but no URL)
    // On mobile this renders via FullScreenItem.jsx, not ItemDetail.jsx
    await page.goto('/#/item/88888');

    // Should display the Ask HN title
    await expect(page.getByText('Ask HN: What are you working on?').first()).toBeVisible();

    // Should display the item body text (sanitized HTML rendered in FullScreenItem)
    await expect(page.getByText(/curious what side projects everyone is working on/i)).toBeVisible();
  });

  test('clears error state when navigating back and forward from not-found item', async ({ page }) => {
    // Regression test: navigating to a non-existent item sets anchorItemId,
    // injectedError, and fetchedItemIdRef. Browser back/forward must properly
    // clear and re-fetch so the correct UI renders at each step.

    // Start at a valid item (creates browser history entry)
    await page.goto('/#/item/12345');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Navigate to a non-existent item via client-side hash change
    await page.evaluate(() => window.location.hash = '#/item/99999999');
    await expect(page.getByText(/not found/i)).toBeVisible();
    // Document title should reflect the error, not stale item title
    await expect(page).toHaveTitle(/Item not found.*HackerTok/);

    // Press browser back — valid item should render
    await page.goBack();
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
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
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 2);
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
    await expect(page.getByText('SQLite Does Not Do Full FSYNC by Default').first()).toBeVisible();

    // Verify scroll position is actually at index 1 (not just that element exists in DOM).
    // Use expect.poll to tolerate brief Firefox scroll-snap drift after goBack.
    await expect.poll(() => container.evaluate(
      (el) => Math.round(el.scrollLeft / el.getBoundingClientRect().width)
    ), { timeout: 5000 }).toBe(1);
  });

  test('restores swipe position at last index after back from not-found item', async ({ page }) => {
    // Regression: swiping to the LAST item (index 2), then navigating to a
    // non-existent item, then pressing back should restore scroll to index 2.

    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 3);
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
    await expect(page.getByText('Why We Moved from React to htmx').first()).toBeVisible();

    // Verify scroll position is actually at index 2 (not just that element exists in DOM).
    // Use expect.poll to tolerate brief Firefox scroll-snap drift after goBack.
    await expect.poll(() => container.evaluate(
      (el) => Math.round(el.scrollLeft / el.getBoundingClientRect().width)
    ), { timeout: 5000 }).toBe(2);
  });

  test('back from best section shows top items, not best items', async ({ page }) => {
    // Start on home (top items)
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 2);
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to index 1 so we have a non-trivial position
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);

    // Navigate to best section via header
    const bestLink = page.getByRole('link', { name: /best/i });
    await bestLink.click({ force: true });

    // Should show best items (distinct from top items)
    await expect(page.getByText('The Art of Finishing Projects').first()).toBeVisible({ timeout: 5000 });

    // Press browser back — should return to top items
    await page.goBack();
    await expect(page.getByText('The Art of Finishing Projects')).not.toBeVisible({ timeout: 5000 });
    // Should show a top item (either the one we were on or the first one)
    await expect(
      page.getByText('Rust Is the Future of JavaScript Infrastructure').or(page.getByText('SQLite Does Not Do Full FSYNC by Default')).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('loads more items when swiping near the end', async ({ page }) => {
    // The swipe viewer triggers loadMore() when within 5 items of the end
    // or when fewer than 10 items are loaded. With only 3 top items in
    // the initial batch, it should auto-load pagination items.

    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 3);
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to the last item in the initial batch
    await smoothScrollAndAwaitSettled(container, panelWidth * 2);
    await waitForScrollAtIndex(page, 2);
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });

    // Wait for more panels to be loaded (pagination items should appear)
    await expect(page.locator('[data-testid="swipe-panel"]').nth(3)).toBeAttached({ timeout: 10000 });

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

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 2);

    // Mock Ask HN items sorted by gravity: item2 (88887, no text) is first,
    // item1 (88888, has story_text) is second. Swipe to the second panel.
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);

    // The body text should be visible — this comes from Algolia's story_text
    // field, NOT from a Firebase re-fetch (which is the point of the test).
    await expect(page.getByText(/curious what side projects everyone is working on/i)).toBeVisible();
  });

  test('navigating directly to a comment shows comment in swipe viewer', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Comment author renders inside the swipe viewer — not the "not a story" guard.
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });

    await expect(page).toHaveURL(/\/item\/1001/);
  });

  test('shows not-available message for job items', async ({ page }) => {
    // Job items (type: 'job') are not stories — SwipeStoryViewer shows an error.
    // Flow: MobileItemResolver fetches item → type is 'job' (not 'comment') →
    // renders SwipeStoryViewer → it fetches again → detects type === 'job' →
    // sets injectedError('job') → renders error UI.
    await page.goto('/#/item/55555');

    await expect(page.getByText('This item is not a story')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /back to feed/i })).toBeVisible();
    await expect(page).toHaveTitle(/Item not available.*HackerTok/);
  });
});

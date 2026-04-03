import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { waitForSwipeReady, smoothScrollAndAwaitSettled, waitForScrollAtIndex } from './fixtures/swipe-helpers';

test.describe('Mobile Swipe Viewer', () => {
  // Use mobile viewport for all tests in this file
  test.use({ 
    viewport: { width: 375, height: 667 },
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Clear viewed items to ensure fresh state
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('shows swipe viewer with item on mobile', async ({ page }) => {
    await page.goto('/#/');
    
    // Should show swipe container on mobile
    const swipeContainer = page.getByTestId('swipe-container');
    await expect(swipeContainer).toBeVisible();

    // Item should be visible in swipe panel
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('can swipe to next item', async ({ page }) => {
    await page.goto('/#/');
    
    // Wait for initial item to load
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Document title should reflect the current (first) story
    await expect(page).toHaveTitle(/Rust Is the Future.*HackerTok/);
    
    // Get the swipe container
    const container = page.getByTestId('swipe-container');
    
    // Wait for container AND at least 2 panels to be ready (ensures second item exists)
    await waitForSwipeReady(page, 2);
    
    // Get panel width using getBoundingClientRect (more reliable than clientWidth)
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);
    
    // Smooth scroll and wait for scrollend event (which triggers app URL update)
    await smoothScrollAndAwaitSettled(container, panelWidth);
    
    // Web-first assertion: toHaveURL auto-retries until URL matches
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

    // Document title should update to the second story after swipe
    await expect(page).toHaveTitle(/SQLite Does Not Do Full FSYNC.*HackerTok/);
  });

  test('scroll-snap behavior works correctly', async ({ page }) => {
    // Tests that scroll-snap actually snaps to boundaries
    // This is a behavior test, not a CSS property test
    await page.goto('/#/');
    
    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();
    
    // Wait for content to load
    await expect(page.getByTestId('swipe-panel').first()).toBeVisible();
    
    // Wait for container AND at least 2 panels to be ready (ensures snapping has targets)
    await waitForSwipeReady(page, 2);
    
    // Get the panel width using getBoundingClientRect
    const panelWidth = await container.evaluate(el => el.getBoundingClientRect().width);
    
    // Set scroll position to middle (between snap points) instantly
    // Then CSS scroll-snap: mandatory should automatically snap to nearest boundary
    await container.evaluate((el, width) => {
      el.scrollLeft = width * 0.5;
    }, panelWidth);
    
    // Use polling to wait for scroll snap to complete
    // CSS scroll-snap animates to boundary, wait until scroll position stabilizes at a snap point
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="swipe-container"]');
      if (!el) return false;
      const scrollLeft = el.scrollLeft;
      const width = el.getBoundingClientRect().width;
      // Check if snapped to boundary (start or panel width, with tolerance)
      return scrollLeft < 10 || Math.abs(scrollLeft - width) < 10;
    }, { timeout: 5000 });
    
    // Verify it snapped to a boundary (either 0 or full panel width)
    const finalScrollLeft = await container.evaluate(el => el.scrollLeft);
    
    // Should snap to nearest boundary - allow small tolerance for rendering differences
    const snappedToStart = finalScrollLeft < 10;
    const snappedToPanel = Math.abs(finalScrollLeft - panelWidth) < 10;
    
    expect(snappedToStart || snappedToPanel).toBe(true);
  });

  test('panels fill viewport width', async ({ page }) => {
    // Using getBoundingClientRect for reliable dimension measurement
    await page.goto('/#/');
    
    const panel = page.getByTestId('swipe-panel').first();
    await expect(panel).toBeVisible();
    
    // Get viewport width
    const viewportWidth = page.viewportSize()?.width || 375;
    const minExpectedWidth = viewportWidth * 0.95;
    
    // Wait for panel to have proper dimensions AND meet minimum width requirement
    // This combines the wait and measurement to avoid race conditions
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
    
    // Panel should be at least 95% of viewport width (allowing for minor padding)
    expect(panelWidth).toBeGreaterThanOrEqual(minExpectedWidth);
  });

  test('can scroll vertically within item', async ({ page }) => {
    await page.goto('/#/');
    
    // Wait for item to load
    await expect(page.getByTestId('swipe-panel').first()).toBeVisible();
    
    // Get the panel (should allow vertical scroll)
    const panel = page.getByTestId('swipe-panel').first();
    
    // Verify the panel has overflow-y set to allow vertical scrolling.
    // The SwipeItemViewer panels use overflow-y: auto so users can scroll
    // through long item content and comments within each panel.
    // Use toPass() to retry until CSS is fully applied (computed style can
    // briefly return "" while stylesheets are still loading).
    await expect(async () => {
      const overflowY = await panel.evaluate((el) => {
        return window.getComputedStyle(el).overflowY;
      });
      expect(['auto', 'scroll']).toContain(overflowY);
    }).toPass();
  });

  test('swipe back to previous item', async ({ page }) => {
    await page.goto('/#/');
    
    // Wait for first item (12345) to load
    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    // Wait for container AND at least 2 panels to be ready
    await waitForSwipeReady(page, 2);
    
    // Get panel width using getBoundingClientRect
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);
    
    // Swipe forward to second item and wait for scrollend
    await smoothScrollAndAwaitSettled(container, width);
    
    // Web-first assertion: toHaveURL auto-retries until URL matches
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });
    
    // Swipe back to first item and wait for scrollend
    await smoothScrollAndAwaitSettled(container, 0);
    
    // Web-first assertion: toHaveURL auto-retries until URL matches
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });
  });

  test('swipe uses replace — back navigates to previous section, not previous item', async ({ page }) => {
    // Swipe-driven URL changes use replaceState (not pushState).
    // Back should exit the swipe viewer entirely, not step through items.
    await page.goto('/#/');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 3);
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe through multiple items — URL updates but no history entries created
    await smoothScrollAndAwaitSettled(container, width);
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

    await smoothScrollAndAwaitSettled(container, width * 2);
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });

    // Verify history length hasn't grown (goto creates 1 entry, replaces keep it at 1)
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
    
    // Should show the item in swipe viewer
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

    // Should have a "past" link to Algolia in the mobile view too
    const pastLink = page.getByRole('link', { name: 'past' }).first();
    await expect(pastLink).toBeVisible();
    await expect(pastLink).toHaveAttribute('href', /hn\.algolia\.com/);
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
    await expect(page).toHaveTitle(/Story not found.*HackerTok/);

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
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

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
    // Playwright's toBeVisible() doesn't check if an element is scrolled into view.
    const scrollIndex = await container.evaluate(
      (el) => Math.round(el.scrollLeft / el.getBoundingClientRect().width)
    );
    expect(scrollIndex).toBe(1);
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
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });
    await smoothScrollAndAwaitSettled(container, panelWidth * 2);
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });

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
    // Playwright's toBeVisible() doesn't check if an element is scrolled into view.
    const scrollIndex = await container.evaluate(
      (el) => Math.round(el.scrollLeft / el.getBoundingClientRect().width)
    );
    expect(scrollIndex).toBe(2);
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
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

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
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });

    // Wait for more panels to be loaded (pagination items should appear)
    await page.waitForFunction((min) => {
      const panels = document.querySelectorAll('[data-testid="swipe-panel"]');
      return panels.length > min;
    }, 3, { timeout: 10000 });

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
    await expect(page).toHaveURL(/\/item\/88888/, { timeout: 5000 });

    // The body text should be visible — this comes from Algolia's story_text
    // field, NOT from a Firebase re-fetch (which is the point of the test).
    await expect(page.getByText(/curious what side projects everyone is working on/i)).toBeVisible();
  });

  test('navigating directly to a comment shows comment in swipe viewer', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Should show the comment content in the swipe viewer (not a "not a story" message)
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });

    // URL should remain on the comment
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

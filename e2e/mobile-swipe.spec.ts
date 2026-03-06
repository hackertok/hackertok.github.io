import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

/**
 * Helper to wait for swipe container to be ready with multiple panels.
 * Uses polling to wait for at least N panels (toHaveCount expects exact match).
 */
async function waitForSwipeReady(page, minPanels = 2) {
  const container = page.getByTestId('swipe-container');
  
  // Verify container is visible first
  await expect(container).toBeVisible();
  
  // Poll for at least minPanels panels to be rendered
  await page.waitForFunction((min) => {
    const panels = document.querySelectorAll('[data-testid="swipe-panel"]');
    return panels.length >= min;
  }, minPanels, { timeout: 5000 });
  
  // Also verify container has rendered dimensions
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="swipe-container"]');
    return el && el.getBoundingClientRect().width > 0;
  }, { timeout: 5000 });
}

/**
 * Smooth-scroll the swipe container and wait for the scrollend event.
 * The app updates the URL in response to scrollend, so waiting for this event
 * (rather than polling scrollLeft) ensures the app's handler has been triggered.
 * 
 * Uses a dual strategy: prefers scrollend event, but falls back to position
 * polling if scrollend doesn't fire (e.g. if scroll was already at target).
 */
async function smoothScrollAndAwaitSettled(container, targetLeft) {
  await container.evaluate((el, left) => {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        el.removeEventListener('scrollend', done);
        resolve();
      };

      // Primary: listen for scrollend (fires after smooth scroll + snap completes)
      el.addEventListener('scrollend', done);
      el.scrollTo({ left, behavior: 'smooth' });

      // Fallback: if scrollend doesn't fire (edge case), poll scroll position.
      // Start polling after 300ms to give scrollend priority.
      setTimeout(() => {
        if (settled) return;
        const poll = () => {
          if (settled) return;
          if (Math.abs(el.scrollLeft - left) < 10) {
            // Position reached — wait a tick for app event handlers to process
            setTimeout(done, 50);
          } else {
            requestAnimationFrame(poll);
          }
        };
        requestAnimationFrame(poll);
      }, 300);
    });
  }, targetLeft);
}

/**
 * Wait for the swipe container's scroll position to settle at the expected panel index.
 * This ensures the app has fully processed a goBack/goForward navigation
 * (scroll position updated, React state settled) before proceeding.
 */
async function waitForScrollAtIndex(page, expectedIndex: number) {
  await page.waitForFunction((idx) => {
    const el = document.querySelector('[data-testid="swipe-container"]');
    if (!el) return false;
    const width = el.getBoundingClientRect().width;
    if (width === 0) return false;
    return Math.round(el.scrollLeft / width) === idx;
  }, expectedIndex, { timeout: 5000 });
}

test.describe('Mobile Swipe Viewer', () => {
  // Use mobile viewport for all tests in this file
  test.use({ 
    viewport: { width: 375, height: 667 },
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Clear viewed stories to ensure fresh state
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('shows swipe viewer with story on mobile', async ({ page }) => {
    await page.goto('/#/');
    
    // Should show swipe container on mobile
    const swipeContainer = page.getByTestId('swipe-container');
    await expect(swipeContainer).toBeVisible();

    // Story should be visible in swipe panel
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
  });

  test('can swipe to next story', async ({ page }) => {
    await page.goto('/#/');
    
    // Wait for initial story to load
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    
    // Get the swipe container
    const container = page.getByTestId('swipe-container');
    
    // Wait for container AND at least 2 panels to be ready (ensures second story exists)
    await waitForSwipeReady(page, 2);
    
    // Get panel width using getBoundingClientRect (more reliable than clientWidth)
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);
    
    // Smooth scroll and wait for scrollend event (which triggers app URL update)
    await smoothScrollAndAwaitSettled(container, panelWidth);
    
    // Web-first assertion: toHaveURL auto-retries until URL matches
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });
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

  test('can scroll vertically within story', async ({ page }) => {
    await page.goto('/#/');
    
    // Wait for story to load
    await expect(page.getByTestId('swipe-panel').first()).toBeVisible();
    
    // Get the panel (should allow vertical scroll)
    const panel = page.getByTestId('swipe-panel').first();
    
    // Verify the panel has overflow-y set to allow vertical scrolling.
    // The SwipeStoryViewer panels use overflow-y: auto so users can scroll
    // through long story content and comments within each panel.
    // Use toPass() to retry until CSS is fully applied (computed style can
    // briefly return "" while stylesheets are still loading).
    await expect(async () => {
      const overflowY = await panel.evaluate((el) => {
        return window.getComputedStyle(el).overflowY;
      });
      expect(['auto', 'scroll']).toContain(overflowY);
    }).toPass();
  });

  test('swipe back to previous story', async ({ page }) => {
    await page.goto('/#/');
    
    // Wait for first story (12345) to load
    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    
    // Wait for container AND at least 2 panels to be ready
    await waitForSwipeReady(page, 2);
    
    // Get panel width using getBoundingClientRect
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);
    
    // Swipe forward to second story and wait for scrollend
    await smoothScrollAndAwaitSettled(container, width);
    
    // Web-first assertion: toHaveURL auto-retries until URL matches
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });
    
    // Swipe back to first story and wait for scrollend
    await smoothScrollAndAwaitSettled(container, 0);
    
    // Web-first assertion: toHaveURL auto-retries until URL matches
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 5000 });
  });

  test('swipe uses replace — back navigates to previous section, not previous story', async ({ page }) => {
    // Swipe-driven URL changes use replaceState (not pushState).
    // Back should exit the swipe viewer entirely, not step through stories.
    await page.goto('/#/');

    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 3);
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe through multiple stories — URL updates but no history entries created
    await smoothScrollAndAwaitSettled(container, width);
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

    await smoothScrollAndAwaitSettled(container, width * 2);
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });

    // Verify history length hasn't grown (goto creates 1 entry, replaces keep it at 1)
    const historyLength = await page.evaluate(() => window.history.length);
    expect(historyLength).toBeLessThanOrEqual(2);
  });
});

test.describe('Mobile Direct Story Access', () => {
  test.use({ 
    viewport: { width: 375, height: 667 },
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('can access story directly via URL on mobile', async ({ page }) => {
    await page.goto('/#/item/12345');
    
    // Should show the story in swipe viewer
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
  });

  test('displays Ask HN body text in mobile swipe view', async ({ page }) => {
    // Navigate to Ask HN story (88888 - has text content but no URL)
    // On mobile this renders via FullScreenStory.jsx, not StoryDetail.jsx
    await page.goto('/#/item/88888');

    // Should display the Ask HN title
    await expect(page.getByText('Ask HN: What are you working on?').first()).toBeVisible();

    // Should display the story body text (sanitized HTML rendered in FullScreenStory)
    await expect(page.getByText(/curious what side projects everyone is working on/i)).toBeVisible();

    // Should have a "past" link to Algolia in the mobile view too
    const pastLink = page.getByRole('link', { name: 'past' }).first();
    await expect(pastLink).toBeVisible();
    await expect(pastLink).toHaveAttribute('href', /hn\.algolia\.com/);
  });

  test('clears error state when navigating back and forward from not-found story', async ({ page }) => {
    // Regression test: navigating to a non-existent story sets anchorStoryId,
    // injectedError, and fetchedStoryIdRef. Browser back/forward must properly
    // clear and re-fetch so the correct UI renders at each step.

    // Start at a valid story (creates browser history entry)
    await page.goto('/#/item/12345');
    await expect(page.getByText('Test Story Title').first()).toBeVisible();

    // Navigate to a non-existent story via client-side hash change
    await page.evaluate(() => window.location.hash = '#/item/99999999');
    await expect(page.getByText(/not found/i)).toBeVisible();
    // Document title should reflect the error, not stale story title
    await expect(page).toHaveTitle(/Story not found.*HackerTok/);

    // Press browser back — valid story should render
    await page.goBack();
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    await expect(page.getByText(/not found/i)).not.toBeVisible();
    await expect(page).toHaveTitle(/Test Story Title.*HackerTok/);

    // Press browser forward — should re-fetch and show error again (not skeleton)
    await page.goForward();
    await expect(page.getByText(/not found/i)).toBeVisible();
  });

  test('restores swipe position when navigating back from not-found story', async ({ page }) => {
    // Regression: swiping away from index 0, then navigating to a non-existent story,
    // then pressing back should restore the scroll position (not reset to index 0).

    await page.goto('/#/');
    await expect(page.getByText('Test Story Title').first()).toBeVisible();

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 2);
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to index 1 (story 12346 — "Second Test Story")
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

    // Navigate to non-existent story
    await page.evaluate(() => window.location.hash = '#/item/99999999');
    await expect(page.getByText(/not found/i)).toBeVisible();

    // Press browser back — should restore to story 12346, not index 0 (12345)
    await page.goBack();
    await expect(page.getByText(/not found/i)).not.toBeVisible();
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });
    await waitForScrollAtIndex(page, 1);
    await expect(page.getByText('Second Test Story').first()).toBeVisible();

    // Verify scroll position is actually at index 1 (not just that element exists in DOM).
    // Playwright's toBeVisible() doesn't check if an element is scrolled into view.
    const scrollIndex = await container.evaluate(
      (el) => Math.round(el.scrollLeft / el.getBoundingClientRect().width)
    );
    expect(scrollIndex).toBe(1);
  });

  test('restores swipe position at last index after back from not-found story', async ({ page }) => {
    // Regression: swiping to the LAST story (index 2), then navigating to a
    // non-existent story, then pressing back should restore scroll to index 2.

    await page.goto('/#/');
    await expect(page.getByText('Test Story Title').first()).toBeVisible();

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 3);
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to index 1, then index 2 (story 12347 — "Third Test Story")
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });
    await smoothScrollAndAwaitSettled(container, panelWidth * 2);
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });

    // Navigate to non-existent story
    await page.evaluate(() => window.location.hash = '#/item/99999999');
    await expect(page.getByText(/not found/i)).toBeVisible();

    // Press browser back — should restore to story 12347 at index 2
    await page.goBack();
    await expect(page.getByText(/not found/i)).not.toBeVisible();
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });
    await waitForScrollAtIndex(page, 2);
    await expect(page.getByText('Third Test Story').first()).toBeVisible();

    // Verify scroll position is actually at index 2 (not just that element exists in DOM).
    // Playwright's toBeVisible() doesn't check if an element is scrolled into view.
    const scrollIndex = await container.evaluate(
      (el) => Math.round(el.scrollLeft / el.getBoundingClientRect().width)
    );
    expect(scrollIndex).toBe(2);
  });

  test('back from best section shows top stories, not best stories', async ({ page }) => {
    // Start on home (top stories)
    await page.goto('/#/');
    await expect(page.getByText('Test Story Title').first()).toBeVisible();

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 2);
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to index 1 so we have a non-trivial position
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await expect(page).toHaveURL(/\/item\/12346/, { timeout: 5000 });

    // Navigate to best section via header
    const bestLink = page.getByRole('link', { name: /best/i });
    await bestLink.click({ force: true });

    // Should show best stories (distinct from top stories)
    await expect(page.getByText('Best Story Alpha').first()).toBeVisible({ timeout: 5000 });

    // Press browser back — should return to top stories
    await page.goBack();
    await expect(page.getByText('Best Story Alpha')).not.toBeVisible({ timeout: 5000 });
    // Should show a top story (either the one we were on or the first one)
    await expect(
      page.getByText('Test Story Title').or(page.getByText('Second Test Story')).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('loads more stories when swiping near the end', async ({ page }) => {
    // The swipe viewer triggers loadMore() when within 5 stories of the end
    // or when fewer than 10 stories are loaded. With only 3 top stories in
    // the initial batch, it should auto-load pagination stories.

    await page.goto('/#/');
    await expect(page.getByText('Test Story Title').first()).toBeVisible();

    const container = page.getByTestId('swipe-container');
    await waitForSwipeReady(page, 3);
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to the last story in the initial batch
    await smoothScrollAndAwaitSettled(container, panelWidth * 2);
    await expect(page).toHaveURL(/\/item\/12347/, { timeout: 5000 });

    // Wait for more panels to be loaded (pagination stories should appear)
    await page.waitForFunction((min) => {
      const panels = document.querySelectorAll('[data-testid="swipe-panel"]');
      return panels.length > min;
    }, 3, { timeout: 10000 });

    // The total panel count should be more than the initial 3
    const panelCount = await page.locator('[data-testid="swipe-panel"]').count();
    expect(panelCount).toBeGreaterThan(3);
  });
});

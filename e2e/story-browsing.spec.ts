import { expect } from '@playwright/test';
import { test as baseTest } from '@playwright/test';
import { test as fixtureTest } from './fixtures/test';
import { setupApiMocks, setupApiMocksWithDelay } from './fixtures/api-mocks';
import { ALGOLIA_API } from './fixtures/mock-data';

// Use base test for most tests
const test = baseTest;

test.describe('Item Browsing', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('loads homepage with top items and metadata', async ({ page }) => {
    await page.goto('/#/');
    
    // Items are visible
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.getByText('SQLite Does Not Do Full FSYNC by Default')).toBeVisible();

    // Item metadata: points and author
    await expect(page.getByText(/284 points/i)).toBeVisible();
    await expect(page.getByText('leerob').first()).toBeVisible();

    // Item links to external URL
    const itemLink = page.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
    await expect(itemLink).toHaveAttribute('href', 'https://example.com/blog/rust');

    // Comment count
    await expect(page.getByText(/137.*comments?/i).first()).toBeVisible();
  });
});

test.describe('Item Browsing - Loading State', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('shows loading skeletons before content loads', async ({ page }, testInfo) => {
    // Desktop only - mobile has different loading UI
    if (testInfo.project.name === 'mobile') {
      test.skip();
      return;
    }
    
    // Set up delayed mocks to allow time to see loading state
    await setupApiMocksWithDelay(page, 1500);
    
    // Navigate - don't wait for load
    await page.goto('/#/', { waitUntil: 'commit' });
    
    // Skeleton should be visible (uses animate-pulse class)
    const skeleton = page.locator('.animate-pulse').first();
    await expect(skeleton).toBeVisible({ timeout: 2000 });
    
    // Wait for actual content to load
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible({ timeout: 5000 });
    
    // Skeletons should be gone (check count is 0)
    await expect(page.locator('.animate-pulse')).toHaveCount(0);
  });
});

test.describe('Item Browsing - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('shows scrollable list on desktop', async ({ page }, testInfo) => {
    // Desktop only
    if (testInfo.project.name === 'mobile') {
      test.skip();
      return;
    }
    
    await page.goto('/#/');
    
    // On desktop, should NOT show swipe container
    const swipeContainer = page.getByTestId('swipe-container');
    await expect(swipeContainer).not.toBeVisible();
    
    // Should show regular item list
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('infinite scroll loads more items at bottom', async ({ page }, testInfo) => {
    // Desktop only
    if (testInfo.project.name === 'mobile') {
      test.skip();
      return;
    }
    
    await page.goto('/#/');
    
    // Wait for initial items to load
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    // Scroll to the bottom to trigger infinite scroll
    // The StoryList component has a trigger element at the bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    
    // Wait for scroll to reach bottom and intersection observer to fire
    await page.waitForFunction(() => {
      const scrolled = window.scrollY + window.innerHeight;
      return scrolled >= document.body.scrollHeight - 10;
    });
    
    // Trigger another scroll to ensure we hit the intersection observer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    
    // Look for pagination items that should load
    // These come from the tags=item mock (day-based pagination)
    await expect(page.getByText('WebAssembly 2.0 Reaches W3C Recommendation')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Item Browsing - Desktop Scroll Restoration', () => {
  // 350px viewport guarantees the page is scrollable with 6 mock items
  // (~500px content height). Max scroll ≈ 150px, well above the 50px threshold.
  test.use({ viewport: { width: 1280, height: 350 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('scroll position restores after back navigation', async ({ page }, testInfo) => {
    if (testInfo.project.name.startsWith('Mobile')) {
      test.skip();
      return;
    }

    await page.goto('/#/');

    // Wait for pagination items to auto-load (trigger is visible within rootMargin)
    await expect(page.getByText('WebAssembly 2.0 Reaches W3C Recommendation')).toBeVisible({ timeout: 10000 });

    // Scroll down explicitly — the 350px viewport guarantees the page is scrollable
    await page.evaluate(() => window.scrollTo({ top: 100, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(100);

    // Click the comments link on the third card — triggers saveSessionState(scrollY)
    const thirdCard = page.locator('[data-testid="story-card"][data-story-id="12347"]');
    const commentLink = thirdCard.getByRole('link', { name: /241.*comments?/i });
    await commentLink.click();

    await expect(page).toHaveURL(/\/item\/12347/);
    await expect(page.getByText('Why We Moved from React to htmx').first()).toBeVisible();

    // Navigate back
    await page.goBack();

    // Wait for list to re-render and scroll position to restore (rAF-based).
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // The scroll position should be restored to approximately where we were
    await expect.poll(
      () => page.evaluate(() => window.scrollY),
      { timeout: 10000 }
    ).toBeGreaterThanOrEqual(80);
  });
});

/**
 * Error handling tests use fixtureTest which provides errorMockedPage.
 * This fixture sets up routes on browserContext BEFORE page creation,
 * avoiding the race condition with page.route() + page.goto().
 */
fixtureTest.describe('Item Browsing - Error Handling', () => {
  // Override deviceScaleFactor to 1: mobile projects inherit high DPR (e.g. iPhone 15 = 3x),
  // which at a 1280x720 viewport means rendering at 3840x2160. Combined with WebKit's slower
  // video recording, this causes the test to exceed the 30s timeout on Mobile Safari.
  fixtureTest.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  // Auto-retry exhausts 3 backoff attempts (2s+4s+8s) before showing error — needs longer timeout
  fixtureTest.setTimeout(60000);

  fixtureTest('shows error state with retry button', async ({ errorMockedPage }) => {
    // Navigate - routes are already set up on the context before page creation
    // Use waitUntil: 'domcontentloaded' to ensure page starts rendering before assertions
    await errorMockedPage.goto('/#/', { waitUntil: 'domcontentloaded' });
    
    // Auto-retry exhausts 3 backoff attempts (2s+4s+8s ≈ 14s), then shows error UI.
    await expect(errorMockedPage.getByText(/Failed to load items/)).toBeVisible({ timeout: 30000 });
    await expect(errorMockedPage.getByRole('button', { name: /try again/i })).toBeVisible();
  });
});

test.describe('End of Feed', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('shows end-of-feed indicator when all best items are loaded', async ({ page }, testInfo) => {
    // Desktop only — mobile uses swipe viewer which doesn't render the end-of-feed StateView
    if (testInfo.project.name.startsWith('Mobile')) {
      test.skip();
      return;
    }

    await page.goto('/#/best');

    // Wait for best items to load (only 3 in mock, all fit in a single page of 30)
    await expect(page.getByText('The Art of Finishing Projects')).toBeVisible();
    await expect(page.getByText('How We Scaled to 1M Users with PostgreSQL')).toBeVisible();
    await expect(page.getByText('A Visual Guide to SSH Tunnels')).toBeVisible();

    // With only 3 items and a page size of 30, hasMore = false → end-of-feed shown
    await expect(page.getByText("You've reached the end")).toBeVisible({ timeout: 5000 });

    // The infinite scroll trigger should NOT be present
    await expect(page.locator('.py-4 .animate-spin')).toHaveCount(0);
  });

  test('shows end-of-feed indicator on domain page after last page', async ({ page }, testInfo) => {
    if (testInfo.project.name.startsWith('Mobile')) {
      test.skip();
      return;
    }

    // Override search_by_date to return a single page (nbPages: 1)
    await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
      const url = new URL(route.request().url());
      const query = url.searchParams.get('query') || '';

      if (query) {
        await route.fulfill({
          json: {
            hits: [
              {
                objectID: '77777',
                title: 'Google Announces Gemini 3.0 with Extended Context',
                url: 'https://example.com/gemini-3',
                author: 'mfiguiere',
                points: 195,
                created_at_i: Math.floor(Date.now() / 1000) - 5400,
                num_comments: 83,
                _tags: ['story'],
              },
            ],
            nbHits: 1,
            page: 0,
            nbPages: 1,
            hitsPerPage: 50,
          },
        });
      } else {
        await route.fulfill({
          json: { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 50 },
        });
      }
    });

    await page.goto('/#/from/example.com');

    // Domain item loads
    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).toBeVisible({ timeout: 10000 });

    // nbPages=1 means page 0 is the only page → hasMore = false → end state
    await expect(page.getByText("You've reached the end")).toBeVisible({ timeout: 5000 });
  });
});

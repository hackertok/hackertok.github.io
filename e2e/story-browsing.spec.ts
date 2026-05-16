import { expect } from '@playwright/test';
import { test as baseTest } from '@playwright/test';
import { test as fixtureTest } from './fixtures/test';
import { setupApiMocks, setupApiMocksWithDelay } from './fixtures/api-mocks';
import { ALGOLIA_API } from './fixtures/mock-data';

const test = baseTest;

test.describe('Item Browsing', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('loads homepage with top items and metadata', async ({ page }) => {
    await page.goto('/#/');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.getByText('SQLite Does Not Do Full FSYNC by Default')).toBeVisible();

    await expect(page.getByText(/284 points/i)).toBeVisible();
    await expect(page.getByText('leerob').first()).toBeVisible();

    const itemLink = page.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
    await expect(itemLink).toHaveAttribute('href', 'https://example.com/blog/rust');

    await expect(page.getByText(/137.*comments?/i).first()).toBeVisible();
  });
});

test.describe('Item Browsing - Loading State', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('shows loading skeletons before content loads', async ({ page }, testInfo) => {
    // Mobile has a different loading UI (swipe viewer skeletons).
    if (testInfo.project.name === 'mobile') {
      test.skip();
      return;
    }

    // Delay mocks so the skeleton is observable before content arrives.
    await setupApiMocksWithDelay(page, 1500);

    // 'commit' returns immediately after navigation commit; do not wait for load.
    await page.goto('/#/', { waitUntil: 'commit' });

    const skeleton = page.locator('.animate-pulse').first();
    await expect(skeleton).toBeVisible({ timeout: 2000 });

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible({ timeout: 5000 });

    await expect(page.locator('.animate-pulse')).toHaveCount(0);
  });
});

test.describe('Item Browsing - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('shows scrollable list on desktop', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      test.skip();
      return;
    }

    await page.goto('/#/');

    const swipeContainer = page.getByTestId('swipe-container');
    await expect(swipeContainer).not.toBeVisible();

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('infinite scroll loads more items at bottom', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      test.skip();
      return;
    }

    await page.goto('/#/');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // StoryList has a sentinel at the bottom watched by IntersectionObserver.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    await page.waitForFunction(() => {
      const scrolled = window.scrollY + window.innerHeight;
      return scrolled >= document.body.scrollHeight - 10;
    });

    // Second scroll forces a fresh intersection event in case the first
    // landed before the observer registered.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Pagination item from the tags=item (day-based) mock.
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

    // Pagination items auto-load because the sentinel is inside rootMargin.
    await expect(page.getByText('WebAssembly 2.0 Reaches W3C Recommendation')).toBeVisible({ timeout: 10000 });

    // 350px viewport + 6 mock items guarantees scrollable content; max
    // scroll ≈ 150px clears the 50px session-save threshold.
    await page.evaluate(() => window.scrollTo({ top: 100, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(100);

    // Clicking the comments link triggers saveSessionState(scrollY).
    // Use native click (via evaluate) instead of Playwright's click() to
    // avoid Playwright's scrollIntoViewIfNeeded step, which can change
    // window.scrollY before the React click handler captures it.
    const thirdCard = page.locator('[data-testid="story-card"][data-story-id="12347"]');
    const commentLink = thirdCard.getByRole('link', { name: /241.*comments?/i });
    await commentLink.evaluate(el => (el as HTMLElement).click());

    await expect(page).toHaveURL(/\/item\/12347/);
    await expect(page.getByText('Why We Moved from React to htmx').first()).toBeVisible();

    await page.goBack();

    // Restoration is rAF-based; wait for the list before polling scrollY.
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await expect.poll(
      () => page.evaluate(() => window.scrollY),
      { timeout: 10_000 }
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
    // Routes are already on the context (set before page creation by the
    // fixture). 'domcontentloaded' ensures the page starts rendering before
    // we begin polling for the error UI.
    await errorMockedPage.goto('/#/', { waitUntil: 'domcontentloaded' });

    // 30s timeout covers the 2+4+8 backoff plus slack.
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
    // Desktop only — mobile swipe viewer doesn't render the end-of-feed StateView.
    if (testInfo.project.name.startsWith('Mobile')) {
      test.skip();
      return;
    }

    await page.goto('/#/best');

    // 3 mock items < page size 30 → hasMore = false on the first response.
    await expect(page.getByText('The Art of Finishing Projects')).toBeVisible();
    await expect(page.getByText('How We Scaled to 1M Users with PostgreSQL')).toBeVisible();
    await expect(page.getByText('A Visual Guide to SSH Tunnels')).toBeVisible();

    await expect(page.getByText("You've reached the end")).toBeVisible({ timeout: 5000 });

    // Infinite scroll spinner must be gone — otherwise the user sees both UIs.
    await expect(page.locator('.py-4 .animate-spin')).toHaveCount(0);
  });

  test('shows end-of-feed indicator on domain page after last page', async ({ page }, testInfo) => {
    if (testInfo.project.name.startsWith('Mobile')) {
      test.skip();
      return;
    }

    // nbPages: 1 → page 0 is the only page → hasMore goes false immediately.
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

    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("You've reached the end")).toBeVisible({ timeout: 5000 });
  });
});

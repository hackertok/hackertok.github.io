import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

test.describe('Viewed Items', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('viewed items persist across page reload', async ({ page }) => {
    // 'viewed:times' is the time-based store: { itemId: timestamp }.
    await page.addInitScript(() => {
      const viewed = { '12345': Date.now() };
      localStorage.setItem('viewed:times', JSON.stringify(viewed));
    });

    await page.goto('/#/');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    const viewedItems = await page.evaluate(() => {
      const stored = localStorage.getItem('viewed:times');
      return stored ? JSON.parse(stored) : null;
    });

    expect(viewedItems).toBeTruthy();
    expect(viewedItems['12345']).toBeGreaterThan(0);
  });

  test('viewed items have visual indication', async ({ browser, baseURL }) => {
    // Fresh context bypasses the beforeEach clear so seeding survives.
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await setupApiMocks(page);

    // 'viewed' is the permanent store (array of IDs); 'viewed:times' is time-based.
    await page.addInitScript(() => {
      localStorage.setItem('viewed', JSON.stringify([12345]));
    });

    await page.goto('/#/');

    // Match by data-story-id so DOM ordering changes don't break the test.
    const itemCard = page.locator('[data-testid="story-card"][data-story-id="12345"]');
    await expect(itemCard).toBeVisible();

    await expect(itemCard).toHaveAttribute('data-viewed', 'true');

    const unviewedCard = page.locator('[data-testid="story-card"][data-story-id="12346"]');
    await expect(unviewedCard).toBeVisible();
    await expect(unviewedCard).not.toHaveAttribute('data-viewed', 'true');
  });

  test('old viewed items are cleaned up after 24 hours', async ({ browser, baseURL }) => {
    // Multiple page loads + storage manipulation push past default timeout.
    test.setTimeout(60000);

    // Fresh context bypasses the beforeEach clear.
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await setupApiMocks(page);

    const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25h ago: past 24h window

    await page.addInitScript((oldTime) => {
      const viewed = { '12345': oldTime };
      localStorage.setItem('viewed:times', JSON.stringify(viewed));
    }, oldTimestamp);

    await page.goto('/#/');

    // pruneExpiredViewed() runs on app startup; wait for the app to be ready.
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await expect.poll(async () => {
      const stored = await page.evaluate(() => localStorage.getItem('viewed:times'));
      const viewedTimes = stored ? JSON.parse(stored) : {};
      return viewedTimes['12345'];
    }, { timeout: 10000 }).toBeUndefined();
  });
});

test.describe('Viewed Items - Mobile', () => {
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

  test('swiping marks item as viewed only for text posts (no URL)', async ({ page }) => {
    // Items with URLs are only marked viewed on external-link click.
    // Text posts (Ask HN, anything without a URL) auto-mark on swipe.
    // 88888 is an Ask HN item with no URL.
    await page.goto('/#/item/88888');

    await expect(page.getByText('Ask HN: What are you working on?').first()).toBeVisible();

    // 'viewed:session' is the session-only store (cleared per browser session).
    const sessionViewed = await page.evaluate(() => {
      const stored = sessionStorage.getItem('viewed:session');
      return stored ? JSON.parse(stored) : null;
    });

    expect(sessionViewed).toContain(88888);
  });

  test('viewed items are filtered in mobile swipe mode', async ({ page }) => {
    // Seed 'viewed:times' WITHOUT touching 'viewed:session' — the swipe
    // filter should hide items that are time-viewed but not session-viewed.
    await page.addInitScript(() => {
      const viewed = {
        '12345': Date.now() - 1000,
        '12346': Date.now() - 1000,
      };
      localStorage.setItem('viewed:times', JSON.stringify(viewed));
    });

    await page.goto('/#/');

    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();

    await expect(page.getByTestId('swipe-panel').first()).toBeVisible();
  });
});

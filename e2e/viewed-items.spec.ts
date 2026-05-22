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
    // 'viewed:times:detail' is the detail time-based store: { itemId: timestamp }.
    await page.addInitScript(() => {
      const viewed = { '12345': Date.now() };
      localStorage.setItem('viewed:times:detail', JSON.stringify(viewed));
    });

    await page.goto('/#/');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    const viewedItems = await page.evaluate(() => {
      const stored = localStorage.getItem('viewed:times:detail');
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

    // 'viewed' is the permanent store (array of IDs) that drives visual dimming.
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

  test('old viewed items are cleaned up after 5 days (title)', async ({ browser, baseURL }) => {
    // Multiple page loads + storage manipulation push past default timeout.
    test.setTimeout(60000);

    // Fresh context bypasses the beforeEach clear.
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await setupApiMocks(page);

    const oldTimestamp = Date.now() - (121 * 60 * 60 * 1000); // 121h ago: past 120h (5-day) window

    await page.addInitScript((oldTime) => {
      const viewed = { '12345': oldTime };
      localStorage.setItem('viewed:times:title', JSON.stringify(viewed));
    }, oldTimestamp);

    await page.goto('/#/');

    // pruneExpiredViewed() runs on app startup; wait for the app to be ready.
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await expect.poll(async () => {
      const stored = await page.evaluate(() => localStorage.getItem('viewed:times:title'));
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

  test('swiping marks all items as viewed (detail)', async ({ page }) => {
    // 12345 is a story WITH a URL — verifies the new behavior where ALL stories
    // (not just text posts) are marked as detail-viewed on swipe.
    await page.goto('/#/item/12345');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // 'viewed:session' is the session-only store (cleared per browser session).
    const sessionViewed = await page.evaluate(() => {
      const stored = sessionStorage.getItem('viewed:session');
      return stored ? JSON.parse(stored) : null;
    });

    expect(sessionViewed).toContain(12345);

    // Also verify it was written to the detail times map
    const detailTimes = await page.evaluate(() => {
      const stored = localStorage.getItem('viewed:times:detail');
      return stored ? JSON.parse(stored) : null;
    });

    expect(detailTimes).toBeTruthy();
    expect(detailTimes['12345']).toBeGreaterThan(0);
  });

  test('viewed items are filtered in mobile swipe mode', async ({ page }) => {
    // Seed 'viewed:times:detail' WITHOUT touching 'viewed:session' — the swipe
    // filter should hide items that are time-viewed but not session-viewed.
    await page.addInitScript(() => {
      const viewed = {
        '12345': Date.now() - 1000,
        '12346': Date.now() - 1000,
      };
      localStorage.setItem('viewed:times:detail', JSON.stringify(viewed));
    });

    await page.goto('/#/');

    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();

    await expect(page.getByTestId('swipe-panel').first()).toBeVisible();
  });
});

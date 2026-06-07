import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { expectActiveSwipePanelText, getActiveSwipePanel } from './fixtures/swipe-helpers';

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
    // 'viewed:times:detail' is the detail time-based store: { itemId: expiresAt }.
    // Seed a live (future) expiry so the entry survives the startup prune.
    await page.addInitScript(() => {
      const viewed = { '12345': Date.now() + 12 * 60 * 60 * 1000 };
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

  test('expired viewed entries are pruned on load; live ones are kept (title)', async ({ browser, baseURL }) => {
    // Multiple page loads + storage manipulation push past default timeout.
    test.setTimeout(60000);

    // Fresh context bypasses the beforeEach clear.
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await setupApiMocks(page);

    // 'viewed:times:title' stores { itemId: expiresAt }. The 5-day window is
    // applied at write time, so prune just drops anything already expired: seed
    // one expired (past) entry and one live (future) entry.
    await page.addInitScript(() => {
      const hour = 60 * 60 * 1000;
      const viewed = {
        '12345': Date.now() - hour, // expired -> pruned on load
        '12346': Date.now() + hour, // live    -> retained
      };
      localStorage.setItem('viewed:times:title', JSON.stringify(viewed));
    });

    await page.goto('/#/');

    // pruneExpiredViewed() runs on app startup; wait for the app to be ready.
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await expect.poll(async () => {
      const stored = await page.evaluate(() => localStorage.getItem('viewed:times:title'));
      const viewedTimes = stored ? JSON.parse(stored) : {};
      return viewedTimes['12345'];
    }, { timeout: 10000 }).toBeUndefined();

    const liveEntry = await page.evaluate(() => {
      const stored = localStorage.getItem('viewed:times:title');
      const viewedTimes = stored ? JSON.parse(stored) : {};
      return viewedTimes['12346'];
    });
    expect(liveEntry).toBeGreaterThan(0);
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

    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');

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
    // filter should hide items whose hide window is still live but not
    // session-viewed. Values are expiresAt, so use a future time (not expired).
    // The top feed is [12345, 12346, 12347, ...]; hiding 12345 + 12346 must
    // promote 12347 ("Why We Moved from React to htmx") to the active panel.
    await page.addInitScript(() => {
      const viewed = {
        '12345': Date.now() + 12 * 60 * 60 * 1000,
        '12346': Date.now() + 12 * 60 * 60 * 1000,
      };
      localStorage.setItem('viewed:times:detail', JSON.stringify(viewed));
    });

    await page.goto('/#/');

    // The first two stories are hidden, so the third is the active panel...
    await expectActiveSwipePanelText(page, 'Why We Moved from React to htmx');

    // ...and the filtered story must not be the one on screen (a filtering
    // regression would leave 12345's title here, which the old "a panel is
    // visible" assertion could not catch).
    const activePanel = getActiveSwipePanel(page);
    await expect(activePanel.getByText('Rust Is the Future of JavaScript Infrastructure')).toHaveCount(0);
  });
});

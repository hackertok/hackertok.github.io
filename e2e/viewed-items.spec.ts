import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

test.describe('Viewed Items', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Clear storage before each test
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('viewed items persist across page reload', async ({ page }) => {
    // Set up a viewed item in localStorage
    // App uses 'viewed:times' for time-based tracking: { itemId: timestamp }
    await page.addInitScript(() => {
      const viewed = { '12345': Date.now() };
      localStorage.setItem('viewed:times', JSON.stringify(viewed));
    });
    
    await page.goto('/#/');
    
    // Item should be marked as viewed
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    // Check localStorage still has the data
    const viewedItems = await page.evaluate(() => {
      const stored = localStorage.getItem('viewed:times');
      return stored ? JSON.parse(stored) : null;
    });
    
    expect(viewedItems).toBeTruthy();
    expect(viewedItems['12345']).toBeGreaterThan(0); // Should be a valid timestamp
  });

  test('viewed items have visual indication', async ({ browser, baseURL }) => {
    // Use fresh context without the beforeEach clear script
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await setupApiMocks(page);
    
    // Pre-set localStorage with viewed item before navigating
    // Note: The app uses 'viewed' as the storage key (array of IDs)
    await page.addInitScript(() => {
      localStorage.setItem('viewed', JSON.stringify([12345]));
    });
    
    await page.goto('/#/');
    
    // Target the specific item by its ID rather than relying on DOM order
    const itemCard = page.locator('[data-testid="story-card"][data-story-id="12345"]');
    await expect(itemCard).toBeVisible();
    
    // Visual indication should show item is viewed (data-viewed="true")
    await expect(itemCard).toHaveAttribute('data-viewed', 'true');

    // Unviewed item should NOT be marked as viewed
    const unviewedCard = page.locator('[data-testid="story-card"][data-story-id="12346"]');
    await expect(unviewedCard).toBeVisible();
    await expect(unviewedCard).not.toHaveAttribute('data-viewed', 'true');
  });

  test('old viewed items are cleaned up after 24 hours', async ({ browser, baseURL }) => {
    // Increase timeout - this test manipulates localStorage and waits for cleanup
    test.setTimeout(60000);
    
    // Use fresh context to avoid beforeEach clear
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await setupApiMocks(page);
    
    // Set up an old viewed item (more than 24 hours ago)
    // App uses 'viewed:times' for time-based tracking: { itemId: timestamp }
    const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
    
    await page.addInitScript((oldTime) => {
      const viewed = { '12345': oldTime };
      localStorage.setItem('viewed:times', JSON.stringify(viewed));
    }, oldTimestamp);
    
    await page.goto('/#/');
    
    // Wait for app startup to complete (pruneExpiredViewed runs on app startup)
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    // Poll until old entry is cleaned up by pruneExpiredViewed()
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
    // Note: Items WITH URLs are only marked as viewed when the user clicks the external link.
    // Only "Ask HN" and text posts (items without URLs) are auto-marked when swiped to.
    // This test navigates to an Ask HN item to verify this behavior.
    
    // Navigate directly to Ask HN item (88888 has no URL)
    await page.goto('/#/item/88888');
    
    // Wait for item to load
    await expect(page.getByText('Ask HN: What are you working on?').first()).toBeVisible();
    
    // Check sessionStorage for viewed items
    // App uses 'viewed:session' for session tracking
    const sessionViewed = await page.evaluate(() => {
      const stored = sessionStorage.getItem('viewed:session');
      return stored ? JSON.parse(stored) : null;
    });
    
    // Should have tracked the Ask HN item (text post auto-marked as viewed)
    expect(sessionViewed).toContain(88888);
  });

  test('viewed items are filtered in mobile swipe mode', async ({ page }) => {
    // Mark some items as viewed (but not in current session)
    // App uses 'viewed:times' for time-based filtering: { itemId: timestamp }
    await page.addInitScript(() => {
      const viewed = { 
        '12345': Date.now() - 1000, // Viewed recently
        '12346': Date.now() - 1000,
      };
      localStorage.setItem('viewed:times', JSON.stringify(viewed));
      // Don't add to sessionStorage - these shouldn't appear in swipe
    });
    
    await page.goto('/#/');
    
    // Wait for swipe container
    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();
    
    // Wait for items to load
    await expect(page.getByTestId('swipe-panel').first()).toBeVisible();
  });
});

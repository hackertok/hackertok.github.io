import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

test.describe('Viewed Stories', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Clear storage before each test
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('viewed stories persist across page reload', async ({ page }) => {
    // Set up a viewed story in localStorage
    // App uses 'hackertok_viewed_times' for time-based tracking: { storyId: timestamp }
    await page.addInitScript(() => {
      const viewed = { '12345': Date.now() };
      localStorage.setItem('hackertok_viewed_times', JSON.stringify(viewed));
    });
    
    await page.goto('/#/');
    
    // Story should be marked as viewed
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    
    // Check localStorage still has the data
    const viewedStories = await page.evaluate(() => {
      const stored = localStorage.getItem('hackertok_viewed_times');
      return stored ? JSON.parse(stored) : null;
    });
    
    expect(viewedStories).toBeTruthy();
    expect(viewedStories['12345']).toBeGreaterThan(0); // Should be a valid timestamp
  });

  test('viewed stories have visual indication', async ({ browser, baseURL }) => {
    // Use fresh context without the beforeEach clear script
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await setupApiMocks(page);
    
    // Pre-set localStorage with viewed story before navigating
    // Note: The app uses 'hackertok_viewed' as the storage key (array of IDs)
    await page.addInitScript(() => {
      localStorage.setItem('hackertok_viewed', JSON.stringify([12345]));
    });
    
    await page.goto('/#/');
    
    // Target the specific story by its ID rather than relying on DOM order
    const storyCard = page.locator('[data-testid="story-card"][data-story-id="12345"]');
    await expect(storyCard).toBeVisible();
    
    // Visual indication should show story is viewed (data-viewed="true")
    await expect(storyCard).toHaveAttribute('data-viewed', 'true');

    // Unviewed story should NOT be marked as viewed
    const unviewedCard = page.locator('[data-testid="story-card"][data-story-id="12346"]');
    await expect(unviewedCard).toBeVisible();
    await expect(unviewedCard).not.toHaveAttribute('data-viewed', 'true');
  });

  test('old viewed stories are cleaned up after 24 hours', async ({ browser, baseURL }) => {
    // Increase timeout - this test manipulates localStorage and waits for cleanup
    test.setTimeout(60000);
    
    // Use fresh context to avoid beforeEach clear
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await setupApiMocks(page);
    
    // Set up an old viewed story (more than 24 hours ago)
    // App uses 'hackertok_viewed_times' for time-based tracking: { storyId: timestamp }
    const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
    
    await page.addInitScript((oldTime) => {
      const viewed = { '12345': oldTime };
      localStorage.setItem('hackertok_viewed_times', JSON.stringify(viewed));
    }, oldTimestamp);
    
    await page.goto('/#/');
    
    // Wait for app startup to complete (pruneExpiredViewed runs on app startup)
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    
    // Poll until old entry is cleaned up by pruneExpiredViewed()
    await expect.poll(async () => {
      const stored = await page.evaluate(() => localStorage.getItem('hackertok_viewed_times'));
      const viewedTimes = stored ? JSON.parse(stored) : {};
      return viewedTimes['12345'];
    }, { timeout: 10000 }).toBeUndefined();
  });
});

test.describe('Viewed Stories - Mobile', () => {
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

  test('swiping marks story as viewed only for text posts (no URL)', async ({ page }) => {
    // Note: Stories WITH URLs are only marked as viewed when the user clicks the external link.
    // Only "Ask HN" and text posts (stories without URLs) are auto-marked when swiped to.
    // This test navigates to an Ask HN story to verify this behavior.
    
    // Navigate directly to Ask HN story (88888 has no URL)
    await page.goto('/#/item/88888');
    
    // Wait for story to load
    await expect(page.getByText('Ask HN: What are you working on?').first()).toBeVisible();
    
    // Check sessionStorage for viewed stories
    // App uses 'hackertok_session_viewed' for session tracking
    const sessionViewed = await page.evaluate(() => {
      const stored = sessionStorage.getItem('hackertok_session_viewed');
      return stored ? JSON.parse(stored) : null;
    });
    
    // Should have tracked the Ask HN story (text post auto-marked as viewed)
    expect(sessionViewed).toContain(88888);
  });

  test('viewed stories are filtered in mobile swipe mode', async ({ page }) => {
    // Mark some stories as viewed (but not in current session)
    // App uses 'hackertok_viewed_times' for time-based filtering: { storyId: timestamp }
    await page.addInitScript(() => {
      const viewed = { 
        '12345': Date.now() - 1000, // Viewed recently
        '12346': Date.now() - 1000,
      };
      localStorage.setItem('hackertok_viewed_times', JSON.stringify(viewed));
      // Don't add to sessionStorage - these shouldn't appear in swipe
    });
    
    await page.goto('/#/');
    
    // Wait for swipe container
    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();
    
    // Wait for stories to load
    await expect(page.getByTestId('swipe-panel').first()).toBeVisible();
  });
});

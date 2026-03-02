import { expect } from '@playwright/test';
import { test as baseTest } from '@playwright/test';
import { test as fixtureTest } from './fixtures/test';
import { setupApiMocks, setupApiMocksWithDelay } from './fixtures/api-mocks';

// Use base test for most tests
const test = baseTest;

test.describe('Story Browsing', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('loads homepage with top stories and metadata', async ({ page }) => {
    await page.goto('/#/');
    
    // Stories are visible
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    await expect(page.getByText('Second Test Story')).toBeVisible();

    // Story metadata: points and author
    await expect(page.getByText(/100 points/i)).toBeVisible();
    await expect(page.getByText('testuser').first()).toBeVisible();

    // Story links to external URL
    const storyLink = page.getByRole('link', { name: 'Test Story Title' });
    await expect(storyLink).toHaveAttribute('href', 'https://example.com/article');

    // Comment count
    await expect(page.getByText(/10.*comments?/i).first()).toBeVisible();
  });
});

test.describe('Story Browsing - Loading State', () => {
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
    await expect(page.getByText('Test Story Title').first()).toBeVisible({ timeout: 5000 });
    
    // Skeletons should be gone (check count is 0)
    await expect(page.locator('.animate-pulse')).toHaveCount(0);
  });
});

test.describe('Story Browsing - Desktop', () => {
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
    
    // Should show regular story list
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
  });

  test('infinite scroll loads more stories at bottom', async ({ page }, testInfo) => {
    // Desktop only
    if (testInfo.project.name === 'mobile') {
      test.skip();
      return;
    }
    
    await page.goto('/#/');
    
    // Wait for initial stories to load
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    
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
    
    // Look for pagination stories that should load
    // These come from the tags=story mock (day-based pagination)
    await expect(page.getByText('Pagination Story One')).toBeVisible({ timeout: 5000 });
  });
});

/**
 * Error handling tests use fixtureTest which provides errorMockedPage.
 * This fixture sets up routes on browserContext BEFORE page creation,
 * avoiding the race condition with page.route() + page.goto().
 */
fixtureTest.describe('Story Browsing - Error Handling', () => {
  fixtureTest.use({ viewport: { width: 1280, height: 720 } });

  fixtureTest('shows error state with retry button', async ({ errorMockedPage }, testInfo) => {
    // Desktop only - mobile project uses WebKit which may behave differently
    if (testInfo.project.name === 'mobile') {
      fixtureTest.skip();
      return;
    }
    
    // Navigate - routes are already set up on the context before page creation
    // Use waitUntil: 'domcontentloaded' to ensure page starts rendering before assertions
    await errorMockedPage.goto('/#/', { waitUntil: 'domcontentloaded' });
    
    // Verify error UI is shown
    await expect(errorMockedPage.getByText(/Failed to load stories/)).toBeVisible({ timeout: 10000 });
    await expect(errorMockedPage.getByRole('button', { name: /try again/i })).toBeVisible();
  });
});

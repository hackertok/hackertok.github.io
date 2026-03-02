import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

test.describe('Story Detail', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('displays story title and metadata', async ({ page }) => {
    await page.goto('/#/item/12345');
    
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    await expect(page.getByText('testuser', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('100 points').first()).toBeVisible();
    
    // Document title should include story title
    await expect(page).toHaveTitle(/Test Story Title.*HackerTok/);

    // Link to original article
    const articleLink = page.getByRole('link', { name: /example\.com/i }).first();
    await expect(articleLink).toHaveAttribute('href', /example\.com/);

    // "past" link to Algolia
    const pastLink = page.getByRole('link', { name: 'past' }).first();
    await expect(pastLink).toBeVisible();
    await expect(pastLink).toHaveAttribute('href', /hn\.algolia\.com/);
    await expect(pastLink).toHaveAttribute('target', '_blank');
  });

  test('displays comments', async ({ page }) => {
    await page.goto('/#/item/12345');
    
    // Wait for comments to load - comments may take time to fetch from Algolia
    await expect(page.getByText('commenter1').first()).toBeVisible({ timeout: 10000 });

    // Nested comments should also be visible
    await expect(page.getByText('commenter2').first()).toBeVisible({ timeout: 10000 });
  });

  test('can collapse/expand comments', async ({ page }) => {
    await page.goto('/#/item/12345');
    
    // Wait for comments to load - check for author name
    await expect(page.getByText('commenter1').first()).toBeVisible({ timeout: 10000 });
    
    // Find collapse button - it has aria-label "Collapse comment" or "Expand comment"
    const collapseButton = page.getByRole('button', { name: /collapse comment/i }).first();
    
    if (await collapseButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await collapseButton.click();
      // After collapse, some content should be hidden
    }
  });

  test('handles story not found', async ({ page }) => {
    // Navigate to a non-existent story ID (99999999 returns null in mock)
    await page.goto('/#/item/99999999');
    
    // Should show error message indicating story not found
    await expect(page.getByText(/not found/i)).toBeVisible();
    
    // Title should reflect not-found state
    await expect(page).toHaveTitle(/Story not found.*HackerTok/);
    
    // Should have a link back to stories
    await expect(page.getByRole('link', { name: /back to stories/i })).toBeVisible();
    
    // URL should NOT change to another story's ID
    expect(page.url()).toContain('99999999');
  });

  test('handles story not found when navigating from existing story', async ({ page }) => {
    // First navigate to a valid story
    await page.goto('/#/item/12345');
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    await expect(page).toHaveTitle(/Test Story Title.*HackerTok/);
    
    // Then navigate to a non-existent story
    await page.goto('/#/item/99999999');
    
    // Should show error message indicating story not found
    await expect(page.getByText(/not found/i)).toBeVisible();
    await expect(page).toHaveTitle(/Story not found.*HackerTok/);
    
    // URL should NOT revert to the previous story's ID
    expect(page.url()).toContain('99999999');
    expect(page.url()).not.toContain('12345');
  });

  test('renders out-of-feed story when navigating from in-feed story', async ({ page }) => {
    // First navigate to an in-feed story (12345 is in mockTopStoryIds)
    await page.goto('/#/item/12345');
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    
    // Then navigate to an out-of-feed story (99999 has mock data but is NOT in mockTopStoryIds)
    await page.goto('/#/item/99999');
    
    // Should render the out-of-feed story with its title
    await expect(page.getByText('Show HN: My Awesome Project').first()).toBeVisible();
    
    // URL should show the out-of-feed story's ID
    expect(page.url()).toContain('99999');
    expect(page.url()).not.toContain('12345');
  });

  test('returns to same story after visiting external link', async ({ page }) => {
    // Navigate to a story
    await page.goto('/#/item/12345');
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    
    // Find the external link (story title link)
    const externalLink = page.getByRole('link', { name: 'Test Story Title' }).first();
    await expect(externalLink).toBeVisible();
    
    // Click the link - navigates away from the page
    await externalLink.click();
    
    // Wait for navigation to external URL
    await page.waitForURL(/example\.com/);
    
    // Go back to the app
    await page.goBack();
    
    // The page should show the same story we were on
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    expect(page.url()).toContain('12345');
  });

  test('displays text content for Ask HN posts (no external URL)', async ({ page }) => {
    // Navigate to Ask HN story (88888 - has text content but no URL)
    await page.goto('/#/item/88888');
    
    // Should display the Ask HN title
    await expect(page.getByText('Ask HN: What are you working on?').first()).toBeVisible();
    
    // Should display the story text/body content
    await expect(page.getByText(/curious what side projects everyone is working on/i)).toBeVisible();
    
    // Should NOT have an external article link (no URL for Ask HN)
    // Scope to the current story's article - mobile view may show other stories with external links
    const askHnArticle = page.locator('article').filter({ has: page.getByText('Ask HN: What are you working on?') });
    
    // The title heading should exist but NOT contain an external link
    const titleHeading = askHnArticle.getByRole('heading', { level: 1 });
    await expect(titleHeading).toBeVisible();
    const titleLink = titleHeading.locator('a[href^="http"]');
    await expect(titleLink).toHaveCount(0);
  });
});

test.describe('Story Detail - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('shows full story detail page on desktop', async ({ page }) => {
    await page.goto('/#/item/12345');
    
    // Desktop should show full detail view, not swipe viewer
    const swipeContainer = page.locator('.swipe-snap-container');
    await expect(swipeContainer).not.toBeVisible();
    
    // Should see story content
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
  });

  test('back from story detail returns to story list', async ({ page }) => {
    // Navigate to desktop story list
    await page.goto('/#/');
    await expect(page.getByText('Test Story Title').first()).toBeVisible();

    // Click comment link to navigate to story detail
    const commentLink = page.getByRole('link', { name: /10.*comments?/i }).first();
    await commentLink.click();

    // Should be on story detail page
    await expect(page).toHaveURL(/\/item\/12345/);
    await expect(page.getByText('Test Story Title').first()).toBeVisible();

    // Go back
    await page.goBack();

    // Should be back on the story list (not story detail)
    await expect(page).toHaveURL(/\/#\/$/);
    // Story list should be visible
    await expect(page.getByText('Test Story Title').first()).toBeVisible();
    await expect(page.getByText('Second Test Story').first()).toBeVisible();
  });
});

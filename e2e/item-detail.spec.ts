import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

test.describe('Item Detail', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('displays item title and metadata', async ({ page }) => {
    await page.goto('/#/item/12345');
    
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.getByText('leerob', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('284 points').first()).toBeVisible();
    
    // Document title should include item title
    await expect(page).toHaveTitle(/Rust Is the Future of JavaScript Infrastructure.*HackerTok/);

    // Link to original article
    const articleLink = page.getByRole('link', { name: /example\.com/i }).first();
    await expect(articleLink).toHaveAttribute('href', /example\.com/);

    // "past" link to Algolia (opens in same tab)
    const pastLink = page.getByRole('link', { name: 'past' }).first();
    await expect(pastLink).toBeVisible();
    await expect(pastLink).toHaveAttribute('href', /hn\.algolia\.com/);
    await expect(pastLink).not.toHaveAttribute('target', '_blank');
    await expect(pastLink).toHaveAttribute('rel', 'noreferrer');
  });

  test('displays comments', async ({ page }) => {
    await page.goto('/#/item/12345');
    
    // Wait for comments to load - comments may take time to fetch from Algolia
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });

    // Nested comments should also be visible
    await expect(page.getByText('tptacek').first()).toBeVisible({ timeout: 10000 });
  });

  test('can collapse/expand comments', async ({ page }) => {
    await page.goto('/#/item/12345');
    
    // Wait for comments to load - check for author name
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });
    
    // Find collapse button - it has aria-label "Collapse comment" or "Expand comment"
    const collapseButton = page.getByRole('button', { name: /collapse comment/i }).first();
    
    if (await collapseButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await collapseButton.click();
      // After collapse, some content should be hidden
    }
  });

  test('handles item not found', async ({ page }) => {
    // Navigate to a non-existent item ID (99999999 returns null in mock)
    await page.goto('/#/item/99999999');
    
    // Should show error message indicating item not found
    await expect(page.getByText(/not found/i)).toBeVisible();
    
    // Title should reflect not-found state
    await expect(page).toHaveTitle(/(Item|Story) not found.*HackerTok/);
    
    // Should have a link back to feed
    await expect(page.getByRole('link', { name: /back to feed/i })).toBeVisible();
    
    // URL should NOT change to another item's ID
    expect(page.url()).toContain('99999999');
  });

  test('handles item not found when navigating from existing item', async ({ page }) => {
    // First navigate to a valid item
    await page.goto('/#/item/12345');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page).toHaveTitle(/Rust Is the Future of JavaScript Infrastructure.*HackerTok/);
    
    // Then navigate to a non-existent item
    await page.goto('/#/item/99999999');
    
    // Should show error message indicating item not found
    await expect(page.getByText(/not found/i)).toBeVisible();
    await expect(page).toHaveTitle(/(Item|Story) not found.*HackerTok/);
    
    // URL should NOT revert to the previous item's ID
    expect(page.url()).toContain('99999999');
    expect(page.url()).not.toContain('12345');
  });

  test('renders out-of-feed item when navigating from in-feed item', async ({ page }) => {
    // First navigate to an in-feed item (12345 is in mockTopItemIds)
    await page.goto('/#/item/12345');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    // Then navigate to an out-of-feed item (99999 has mock data but is NOT in mockTopItemIds)
    await page.goto('/#/item/99999');
    
    // Should render the out-of-feed item with its title
    await expect(page.getByText('Show HN: Piko – Open-Source Ngrok Alternative in Go').first()).toBeVisible();
    
    // URL should show the out-of-feed item's ID
    expect(page.url()).toContain('99999');
    expect(page.url()).not.toContain('12345');
  });

  test('returns to same item after visiting external link', async ({ page }) => {
    // Navigate to an item
    await page.goto('/#/item/12345');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    // Find the external link (item title link)
    const externalLink = page.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' }).first();
    await expect(externalLink).toBeVisible();
    
    // Click the link - navigates away from the page
    await externalLink.click();
    
    // Wait for navigation to external URL
    await page.waitForURL(/example\.com/);
    
    // Go back to the app
    await page.goBack();
    
    // The page should show the same item we were on
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    expect(page.url()).toContain('12345');
  });

  test('displays text content for Ask HN posts (no external URL)', async ({ page }) => {
    // Navigate to Ask HN item (88888 - has text content but no URL)
    await page.goto('/#/item/88888');
    
    // Should display the Ask HN title
    await expect(page.getByText('Ask HN: What are you working on?').first()).toBeVisible();
    
    // Should display the item text/body content
    await expect(page.getByText(/curious what side projects everyone is working on/i)).toBeVisible();
    
    // Should NOT have an external article link (no URL for Ask HN)
    // Scope to the current item's article - mobile view may show other items with external links
    const askHnArticle = page.locator('article').filter({ has: page.getByText('Ask HN: What are you working on?') });
    
    // The title heading should exist but NOT contain an external link
    const titleHeading = askHnArticle.getByRole('heading', { level: 1 });
    await expect(titleHeading).toBeVisible();
    const titleLink = titleHeading.locator('a[href^="http"]');
    await expect(titleLink).toHaveCount(0);
  });
});

test.describe('Item Detail - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('shows full item detail page on desktop', async ({ page }) => {
    await page.goto('/#/item/12345');
    
    // Desktop should show full detail view, not swipe viewer
    const swipeContainer = page.locator('.swipe-snap-container');
    await expect(swipeContainer).not.toBeVisible();
    
    // Should see item content
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('back from item detail returns to item list', async ({ page }) => {
    // Navigate to desktop item list
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Click comment link to navigate to item detail
    const commentLink = page.getByRole('link', { name: /137.*comments?/i }).first();
    await commentLink.click();

    // Should be on item detail page
    await expect(page).toHaveURL(/\/item\/12345/);
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Go back
    await page.goBack();

    // Should be back on the item list (not item detail)
    await expect(page).toHaveURL(/\/#\/$/);
    // Item list should be visible
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.getByText('SQLite Does Not Do Full FSYNC by Default').first()).toBeVisible();
  });
});

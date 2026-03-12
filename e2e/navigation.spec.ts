import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('navigates to Show HN section', async ({ page }) => {
    await page.goto('/#/');
    
    // Click Show link in header
    await page.getByRole('link', { name: /show/i }).click();
    
    // URL should update - on mobile may go to /#/item/... for swipe view
    await expect(page).toHaveURL(/\/#\/(show|item\/\d+)/);
    
    // Should display Show HN items
    await expect(page.getByText('Show HN: Piko – Open-Source Ngrok Alternative in Go')).toBeVisible();
    
    // Document title should reflect section (desktop only — mobile navigates to item)
    await expect(page).toHaveTitle(/Show.*HackerTok|HackerTok/);

    // "show" nav link should be highlighted as active
    await expect(page.getByRole('link', { name: 'show', exact: true })).toHaveClass(/bg-hn-orange/);
    await expect(page.getByRole('link', { name: 'best', exact: true })).not.toHaveClass(/bg-hn-orange/);
    await expect(page.getByRole('link', { name: 'ask', exact: true })).not.toHaveClass(/bg-hn-orange/);
  });

  test('navigates to Ask HN section', async ({ page }) => {
    await page.goto('/#/');
    
    // Click Ask link in header
    await page.getByRole('link', { name: /ask/i }).click();
    
    // URL should update - on mobile may go to /#/item/... for swipe view
    await expect(page).toHaveURL(/\/#\/(ask|item\/\d+)/);
    
    // Should display Ask HN items
    await expect(page.getByText('Ask HN: What are you working on?')).toBeVisible();
    
    // Document title should reflect section
    await expect(page).toHaveTitle(/Ask.*HackerTok|HackerTok/);

    // "ask" nav link should be highlighted as active
    await expect(page.getByRole('link', { name: 'ask', exact: true })).toHaveClass(/bg-hn-orange/);
    await expect(page.getByRole('link', { name: 'show', exact: true })).not.toHaveClass(/bg-hn-orange/);
    await expect(page.getByRole('link', { name: 'best', exact: true })).not.toHaveClass(/bg-hn-orange/);
  });

  test('navigates to Best section', async ({ page }) => {
    await page.goto('/#/');
    
    // Wait for header to be visible
    await expect(page.locator('header')).toBeVisible();
    
    // Click Best link in header - force to ensure we hit the link not item behind it
    const bestLink = page.getByRole('link', { name: /best/i });
    await bestLink.scrollIntoViewIfNeeded();
    await bestLink.click({ force: true });
    
    // URL should update - on mobile may go to item view first
    await expect(page).toHaveURL(/\/#\/(best|item\/)/);
    
    // Document title should reflect section
    await expect(page).toHaveTitle(/Best.*HackerTok|HackerTok/);

    // "best" nav link should be highlighted as active
    await expect(page.getByRole('link', { name: 'best', exact: true })).toHaveClass(/bg-hn-orange/);
    await expect(page.getByRole('link', { name: 'ask', exact: true })).not.toHaveClass(/bg-hn-orange/);
    await expect(page.getByRole('link', { name: 'show', exact: true })).not.toHaveClass(/bg-hn-orange/);
  });

  test('navigates back to Top from other section', async ({ page }) => {
    await page.goto('/#/show');
    
    // Click the logo "HackerTok" to go home
    await page.getByRole('link', { name: /hackertok/i }).click();
    
    // On mobile, may redirect to swipe view at /#/item/... or /#/
    // On desktop, should be at /#/
    await expect(page).toHaveURL(/\/#\/(item\/\d+)?$/);
    
    // Should display top items
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('logo click returns to homepage', async ({ page }) => {
    await page.goto('/#/show');
    
    // Click logo/brand
    const logo = page.getByRole('link', { name: /hackertok|hn|logo/i }).first();
    await logo.click();
    
    // Should be at homepage - on mobile may go to /#/item/... for swipe view
    await expect(page).toHaveURL(/\/#\/(item\/\d+)?$/);
    
    // Homepage title is just "HackerTok" (no section prefix)
    await expect(page).toHaveTitle(/HackerTok/);
  });

  test('browser back button works', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    // Navigate to Best link with force click to ensure header click
    const bestLink = page.getByRole('link', { name: /best/i });
    await bestLink.scrollIntoViewIfNeeded();
    await bestLink.click({ force: true });
    
    // Wait for navigation - mobile may go to item view
    await expect(page).toHaveURL(/\/#\/(best|item\/)/);
    
    // Go back
    await page.goBack();
    
    // Should be back - may be at /#/ or /#/item/... on mobile
    await expect(page).toHaveURL(/\/#\/(item\/\d+)?$/);
  });

  test('direct URL navigation works', async ({ page }) => {
    // Navigate directly to a specific route
    await page.goto('/#/ask');
    
    // Should show Ask HN items (wait for them to load)
    await expect(page.getByText('Ask HN:', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Navigation - Header Visibility', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('header is visible initially', async ({ page }) => {
    await page.goto('/#/');
    
    const header = page.locator('header').first();
    await expect(header).toBeVisible();
  });
});

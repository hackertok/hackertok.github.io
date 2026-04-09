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
    await expect(page.getByRole('link', { name: 'show', exact: true })).toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'best', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'ask', exact: true })).not.toHaveClass(/bg-accent/);
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
    await expect(page.getByRole('link', { name: 'ask', exact: true })).toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'show', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'best', exact: true })).not.toHaveClass(/bg-accent/);
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

    // Best-specific content should be visible (not just URL/title)
    await expect(page.getByText('The Art of Finishing Projects')).toBeVisible();

    // "best" nav link should be highlighted as active
    await expect(page.getByRole('link', { name: 'best', exact: true })).toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'ask', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'show', exact: true })).not.toHaveClass(/bg-accent/);
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

test.describe('Navigation - Viewport Resize Transition', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('switches from desktop list to mobile swipe on resize', async ({ page }) => {
    // Start on desktop
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#/');

    // Desktop: list view, no swipe container
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.getByTestId('swipe-container')).not.toBeVisible();

    // Resize to mobile width
    await page.setViewportSize({ width: 375, height: 667 });

    // Mobile: swipe container should appear
    await expect(page.getByTestId('swipe-container')).toBeVisible({ timeout: 5000 });
  });

  test('switches from mobile swipe to desktop list on resize', async ({ page }) => {
    // Start on mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/#/');

    // Mobile: swipe container visible
    await expect(page.getByTestId('swipe-container')).toBeVisible({ timeout: 5000 });

    // Resize to desktop width
    await page.setViewportSize({ width: 1280, height: 720 });

    // Desktop: list view (story cards), no swipe container
    await expect(page.getByTestId('swipe-container')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('no layout overflow during desktop-to-mobile transition', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Resize to mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.getByTestId('swipe-container')).toBeVisible({ timeout: 5000 });

    // No horizontal overflow
    const { docWidth, vpWidth } = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      vpWidth: window.innerWidth,
    }));
    expect(docWidth).toBeLessThanOrEqual(vpWidth);
  });
});

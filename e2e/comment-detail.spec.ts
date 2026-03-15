import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

test.describe('Comment Detail', () => {
  // Comment detail only renders on desktop (ItemDetail); on mobile, SwipeStoryViewer is used
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('displays comment author, text, and navigation links', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Should show comment author
    await expect(page.getByText('patio11').first()).toBeVisible();

    // Should show comment text
    await expect(page.getByText(/wasm-bindgen/i).first()).toBeVisible();

    // Should show parent link
    const parentLink = page.getByRole('link', { name: 'parent' }).first();
    await expect(parentLink).toBeVisible();

    // Should show "on: Item Title" link
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Document title should contain comment author
    await expect(page).toHaveTitle(/Comment by patio11.*HackerTok/);
  });

  test('displays replies', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Should show reply author
    await expect(page.getByText('tptacek').first()).toBeVisible({ timeout: 10000 });

    // Should show reply text
    await expect(page.getByText(/DX improvements/i).first()).toBeVisible();

    // Should show reply count
    await expect(page.getByText(/1 reply/i).first()).toBeVisible();
  });

  test('parent link navigates to parent item', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Wait for parent link to appear
    const parentLink = page.getByRole('link', { name: 'parent' }).first();
    await expect(parentLink).toBeVisible();

    // Click parent link
    await parentLink.click();

    // Should navigate to parent item
    await expect(page).toHaveURL(/\/item\/12345/);

    // Parent is an item, should show item view
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('"on: Item Title" link navigates to item', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Wait for item title to load
    const itemLink = page.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' }).first();
    await expect(itemLink).toBeVisible();

    // Click item link
    await itemLink.click();

    // Should navigate to item
    await expect(page).toHaveURL(/\/item\/12345/);
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('item permalink still works (no regression)', async ({ page }) => {
    await page.goto('/#/item/12345');

    // Should show normal item view
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.getByText('284 points').first()).toBeVisible();

    // Should NOT show comment-only elements like "parent" link
    // The "parent" link is a comment-detail feature
    await expect(page.getByRole('link', { name: 'parent' })).not.toBeVisible();

    // Title should be item title
    await expect(page).toHaveTitle(/Rust Is the Future of JavaScript Infrastructure.*HackerTok/);
  });
});

test.describe('Comment Detail - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('shows comment detail page on desktop', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Should show comment content
    await expect(page.getByText('patio11').first()).toBeVisible();
    await expect(page.getByText(/wasm-bindgen/i).first()).toBeVisible();

    // Desktop should not show swipe viewer
    const swipeContainer = page.locator('.swipe-snap-container');
    await expect(swipeContainer).not.toBeVisible();
  });
});

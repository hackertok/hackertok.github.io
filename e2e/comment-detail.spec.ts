import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { ALGOLIA_API } from './fixtures/mock-data';

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

test.describe('Comment Detail - Error + Retry', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  // Auto-retry exhausts 3 backoff attempts (2s+4s+8s) before showing error
  test.setTimeout(60000);

  test('shows error state with retry button when Algolia fails', async ({ page }) => {
    await setupApiMocks(page);

    // Override Algolia items endpoint for comment 1001 to return 500
    await page.route(`${ALGOLIA_API}/items/1001`, async (route) => {
      await route.fulfill({ status: 500, json: { error: 'Server Error' } });
    });

    await page.goto('/#/item/1001');

    // Auto-retry exhausts 3 backoff attempts (2s+4s+8s ≈ 14s), then shows error UI
    await expect(page.getByText('Failed to load comment')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
  });

  test('recovers after retry when Algolia temporarily fails', async ({ page }) => {
    await setupApiMocks(page);

    let shouldFail = true;
    // Override Algolia items endpoint for comment 1001
    await page.route(`${ALGOLIA_API}/items/1001`, async (route) => {
      if (shouldFail) {
        await route.fulfill({ status: 500, json: { error: 'Server Error' } });
      } else {
        await route.fulfill({
          json: {
            id: 1001,
            author: 'patio11',
            text: 'The <code>wasm-bindgen</code> approach is really interesting.',
            created_at_i: Math.floor(Date.now() / 1000) - 1800,
            parent_id: 12345,
            story_id: 12345,
            children: [],
            type: 'comment',
          },
        });
      }
    });

    await page.goto('/#/item/1001');

    // Wait for auto-retry to exhaust (2s+4s+8s ≈ 14s) → error state
    await expect(page.getByText('Failed to load comment')).toBeVisible({ timeout: 30000 });
    const retryButton = page.getByRole('button', { name: /retry/i });
    await expect(retryButton).toBeVisible();

    // Stop failing before clicking retry
    shouldFail = false;
    await retryButton.click();

    // Comment should load successfully
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/wasm-bindgen/i).first()).toBeVisible();
  });
});

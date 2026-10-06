import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { ALGOLIA_API } from './fixtures/mock-data';

test.describe('Comment Detail', () => {
  // Desktop-only: mobile uses SwipeStoryViewer instead of ItemDetail.
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('displays comment author, text, and navigation links', async ({ page }) => {
    await page.goto('/#/item/1001');

    await expect(page.getByText('patio11').first()).toBeVisible();

    await expect(page.getByText(/wasm-bindgen/i).first()).toBeVisible();

    const parentLink = page.getByRole('link', { name: 'parent' }).first();
    await expect(parentLink).toBeVisible();

    // Item title link points to the thread that hosts the comment.
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await expect(page).toHaveTitle(/Comment by patio11.*HackerTok/);
  });

  test('displays replies', async ({ page }) => {
    await page.goto('/#/item/1001');

    await expect(page.getByText('tptacek').first()).toBeVisible({ timeout: 10000 });

    await expect(page.getByText(/DX improvements/i).first()).toBeVisible();
  });

  test('parent link navigates to parent item', async ({ page }) => {
    await page.goto('/#/item/1001');

    const parentLink = page.getByRole('link', { name: 'parent' }).first();
    await expect(parentLink).toBeVisible();

    await parentLink.click();

    await expect(page).toHaveURL(/\/item\/12345/);

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('item title link navigates to item', async ({ page }) => {
    await page.goto('/#/item/1001');

    const itemLink = page.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' }).first();
    await expect(itemLink).toBeVisible();

    await itemLink.click();

    await expect(page).toHaveURL(/\/item\/12345/);
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('item permalink still works (no regression)', async ({ page }) => {
    await page.goto('/#/item/12345');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.getByText('284 points').first()).toBeVisible();

    // "parent" is a comment-detail-only affordance and must not bleed into item view.
    await expect(page.getByRole('link', { name: 'parent' })).not.toBeVisible();

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

    await expect(page.getByText('patio11').first()).toBeVisible();
    await expect(page.getByText(/wasm-bindgen/i).first()).toBeVisible();

    // Mobile-only swipe container must not appear at desktop width.
    const swipeContainer = page.locator('.swipe-snap-container');
    await expect(swipeContainer).not.toBeVisible();
  });
});

test.describe('Comment Detail - Error + Retry', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  // Auto-retry exhausts 3 backoff attempts (2s+4s+8s) before surfacing error UI.
  test.setTimeout(60000);

  test('keeps the comment and offers to retry its replies when Algolia fails', async ({ page }) => {
    await setupApiMocks(page);

    await page.route(`${ALGOLIA_API}/items/1001`, async (route) => {
      await route.fulfill({ status: 500, json: { error: 'Server Error' } });
    });

    await page.goto('/#/item/1001');

    // The comment itself comes from Firebase.
    const firebaseText = page.getByText(/really well-written piece/);
    await expect(firebaseText).toBeVisible();

    // 30s timeout covers the 2+4+8 backoff plus slack.
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible({ timeout: 30000 });
    await expect(firebaseText).toBeVisible();
    await expect(page.getByText('Failed to load comment')).not.toBeVisible();
  });

  test('loads the replies on retry once Algolia recovers', async ({ page }) => {
    await setupApiMocks(page);

    let shouldFail = true;
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
            children: [{
              id: 2001,
              author: 'tptacek',
              text: 'A reply that loaded on retry.',
              created_at_i: Math.floor(Date.now() / 1000) - 900,
              parent_id: 1001,
              children: [],
            }],
            type: 'comment',
          },
        });
      }
    });

    await page.goto('/#/item/1001');

    const retryButton = page.getByRole('button', { name: /retry/i });
    await expect(retryButton).toBeVisible({ timeout: 30000 });

    // Flip the failure switch BEFORE the retry click so the next request succeeds.
    shouldFail = false;
    await retryButton.click();

    await expect(page.getByText('A reply that loaded on retry.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/wasm-bindgen/i).first()).toBeVisible();
    await expect(retryButton).not.toBeVisible();
  });
});

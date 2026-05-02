import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { waitForSwipeReady, smoothScrollAndAwaitSettled, waitForScrollAtIndex } from './fixtures/swipe-helpers';

test.describe('Mobile Comment Swipe Viewer', () => {
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

  test('navigating to a comment stays on that comment (no redirect, including direct URL)', async ({ page }) => {
    // Regression test: navigating to comment 1001 should NOT redirect to first sibling.
    // This also covers direct URL access (page.goto never passes React Router state,
    // so MobileItemResolver resolves the type via Firebase).
    await page.goto('/#/item/1001');

    // Should show the comment's author (patio11)
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });

    // URL must still be on the original comment, not redirected to a sibling
    await expect(page).toHaveURL(/\/item\/1001/, { timeout: 5000 });
  });

  test('shows comment content in swipe viewer on mobile', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Should show swipe container
    const swipeContainer = page.getByTestId('swipe-container');
    await expect(swipeContainer).toBeVisible();

    // Comment author should be visible
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });

    // Comment text should be visible
    await expect(page.getByText(/wasm-bindgen/i).first()).toBeVisible();
  });

  test('loads sibling comments as swipeable panels', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Wait for siblings to load (parent story 12345 has kids: [1001, 1002, 1003])
    await waitForSwipeReady(page, 3);

    // Should have 3 panels for 3 siblings
    const panels = page.getByTestId('swipe-panel');
    await expect(panels).toHaveCount(3);
  });

  test('can swipe to next sibling comment', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Wait for all siblings to load
    await waitForSwipeReady(page, 3);

    const container = page.getByTestId('swipe-container');
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to second sibling (comment 1002)
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });

    // Should show the second comment's author
    await expect(page.getByText('jgrahamc').first()).toBeVisible({ timeout: 10000 });
  });

  test('can swipe through multiple siblings and back', async ({ page }) => {
    await page.goto('/#/item/1001');

    await waitForSwipeReady(page, 3);

    const container = page.getByTestId('swipe-container');
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to comment 1002
    await smoothScrollAndAwaitSettled(container, width);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });

    // Swipe to comment 1003
    await smoothScrollAndAwaitSettled(container, width * 2);
    await waitForScrollAtIndex(page, 2);
    await expect(page).toHaveURL(/\/item\/1003/, { timeout: 5000 });

    // Swipe back to comment 1002
    await smoothScrollAndAwaitSettled(container, width);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });

    // Swipe back to comment 1001
    await smoothScrollAndAwaitSettled(container, 0);
    await waitForScrollAtIndex(page, 0);
    await expect(page).toHaveURL(/\/item\/1001/, { timeout: 5000 });
  });

  test('shows parent and story links in comment', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Wait for comment content
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });

    // Should show parent link
    const parentLink = page.getByRole('link', { name: 'parent' }).first();
    await expect(parentLink).toBeVisible();

    // Should show item title link (the thread the comment is on)
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('header shows "comments" indicator on mobile comment view', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Wait for comment to load
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });

    // Header should show "comments" indicator
    await expect(page.getByText('comments').first()).toBeVisible();
  });

  test('swipe uses replaceState — no extra history entries', async ({ page }) => {
    await page.goto('/#/item/1001');

    await waitForSwipeReady(page, 3);

    const container = page.getByTestId('swipe-container');
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe through siblings
    await smoothScrollAndAwaitSettled(container, width);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });

    await smoothScrollAndAwaitSettled(container, width * 2);
    await waitForScrollAtIndex(page, 2);
    await expect(page).toHaveURL(/\/item\/1003/, { timeout: 5000 });

    // History should not have grown (goto = 1 entry, replaces keep it there)
    const historyLength = await page.evaluate(() => window.history.length);
    expect(historyLength).toBeLessThanOrEqual(2);
  });

  test('in-panel links have correct hrefs and comments indicator clears when leaving comment view', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Wait for comment to load and verify "comments" indicator is shown
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('comments').first()).toBeVisible();

    // Verify the item title link inside the swipe panel has the correct href
    const firstPanel = page.locator('[data-item-id="1001"]');
    const storyLink = firstPanel.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
    await expect(storyLink).toHaveAttribute('href', '#/item/12345');

    // Verify parent link also has correct href
    const parentLink = firstPanel.getByRole('link', { name: 'parent' });
    await expect(parentLink).toHaveAttribute('href', '#/item/12345');

    // Navigate away from the comment view via the router. We previously
    // clicked the header "Best" link directly, but the responsive packer
    // (added by the modernization commit) now pushes Best/Show/Ask into
    // a "More" dropdown when the comments pill is active at 375px — and
    // simulating that interaction is brittle across Firefox (which
    // sometimes drops the click while the swipe-viewer focus trap is
    // active). The actual contract being tested here is "leaving comment
    // view clears the comments indicator", which a hash-route push
    // exercises just as well, without coupling to the header layout.
    await page.evaluate(() => {
      window.location.hash = '#/best';
    });
    // On mobile, swipe viewer immediately replaces /#/best with /#/item/{id}
    await expect(page).toHaveURL(/\/#\/(best|item\/)/, { timeout: 5000 });

    // "comments" indicator should no longer be shown (we left comment view)
    await expect(page.getByText('comments', { exact: true })).not.toBeVisible({ timeout: 5000 });
  });

  test('shows "Comment deleted" for dead/deleted comment', async ({ page }) => {
    // Override Firebase to return 5555 as a comment (so MobileItemResolver detects comment type)
    await page.route(`**/item/5555.json`, async (route) => {
      await route.fulfill({
        json: {
          id: 5555,
          by: null,
          text: null,
          time: Math.floor(Date.now() / 1000) - 600,
          parent: 12345,
          type: 'comment',
          dead: true,
        },
      });
    });

    // Override Algolia items to return a deleted comment for id 5555
    await page.route(`**/items/5555`, async (route) => {
      await route.fulfill({
        json: {
          id: 5555,
          type: 'comment',
          author: null,
          text: null,
          created_at_i: Math.floor(Date.now() / 1000) - 600,
          parent_id: 12345,
          story_id: 12345,
          children: [],
        },
      });
    });

    // Override Firebase parent to return only kid 5555
    await page.route(`**/item/12345.json`, async (route) => {
      await route.fulfill({
        json: {
          id: 12345,
          title: 'Rust Is the Future of JavaScript Infrastructure',
          url: 'https://leerob.io/blog/rust',
          by: 'leerob',
          score: 284,
          time: Math.floor(Date.now() / 1000) - 3600,
          descendants: 1,
          kids: [5555],
          type: 'story',
        },
      });
    });

    await page.goto('/#/item/5555');

    // Should show deleted comment UI
    await expect(page.getByText('Comment deleted').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows error state when comment fetch fails', async ({ page }) => {
    // Auto-retry exhausts 3 backoff attempts (2s+4s+8s) before error state appears
    test.setTimeout(60000);
    // Return a valid comment for 99999 so MobileItemResolver discovers it's a comment,
    // but point its parent to 88888 which will return 500
    await page.route(`**/item/99999.json`, async (route) => {
      await route.fulfill({
        json: {
          id: 99999,
          by: 'someone',
          text: 'placeholder',
          time: Math.floor(Date.now() / 1000) - 600,
          parent: 88888,
          type: 'comment',
        },
      });
    });

    // Parent fetch fails — useSiblingComments errors out
    await page.route(`**/item/88888.json`, async (route) => {
      await route.fulfill({ status: 500, json: { error: 'Server Error' } });
    });

    // Algolia also fails for this comment (useCommentDetail)
    await page.route(`**/items/99999`, async (route) => {
      await route.fulfill({ status: 500, json: { error: 'Server Error' } });
    });

    await page.goto('/#/item/99999');

    // Should show error state in the swipe viewer (auto-retry exhausts 3 attempts with 2s+4s+8s backoff before giving up)
    await expect(page.getByText('Failed to load comments').first()).toBeVisible({ timeout: 30000 });
  });

  test('sets document title to "Comment by {author}" for the current comment', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Wait for comment data to load (patio11 is the author of comment 1001)
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });

    // Document title should show the comment author
    await expect(page).toHaveTitle(/Comment by patio11/);
  });

  test('clicking item title link navigates to story viewer, not comment viewer', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Scope to the current panel to avoid strict mode violation (each sibling has an item title link)
    const firstPanel = page.locator('[data-item-id="1001"]');
    const storyLink = firstPanel.getByRole('link', { name: /Rust Is the Future/ });
    await expect(storyLink).toBeVisible({ timeout: 10000 });

    // Click the story title link
    await storyLink.click();

    // Should navigate to the story URL
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 10000 });

    // Should show story content (SwipeStoryViewer), not comment viewer.
    // The story title in the document title confirms we're in the story viewer.
    await expect(page).toHaveTitle(/Rust Is the Future|HackerTok/, { timeout: 10000 });

    // Should NOT show "Failed to load comments" or be stuck on skeleton
    await expect(page.getByText('Failed to load comments')).not.toBeVisible();
  });

  test('swipe to sibling then click parent navigates to story viewer', async ({ page }) => {
    await page.goto('/#/item/1001');
    await waitForSwipeReady(page, 3);

    const container = page.getByTestId('swipe-container');
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    // Swipe to second sibling (comment 1002)
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });
    await expect(page.getByText('jgrahamc').first()).toBeVisible({ timeout: 10000 });

    // Click "parent" from the 1002 panel
    const panel1002 = page.locator('[data-item-id="1002"]');
    await panel1002.getByRole('link', { name: 'parent' }).click();

    // Should navigate to the parent story and render SwipeStoryViewer
    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 10000 });
    await expect(page).toHaveTitle(/Rust Is the Future/, { timeout: 10000 });
  });

  test('clicking parent on nested comment navigates to parent comment viewer', async ({ page }) => {
    // Comment 2001 is a reply to comment 1001 (which is a top-level comment on story 12345).
    // Its "parent" link should carry isComment: true and land in SwipeCommentViewer for 1001.
    await page.goto('/#/item/2001');

    // Wait for the nested comment author
    await expect(page.getByText('tptacek').first()).toBeVisible({ timeout: 10000 });

    // Click "parent" — should navigate to comment 1001
    await page.getByRole('link', { name: 'parent' }).click();
    await expect(page).toHaveURL(/\/item\/1001/, { timeout: 10000 });

    // Should render SwipeCommentViewer with 1001's siblings (1001, 1002, 1003)
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveTitle(/Comment by patio11/);

    // Confirm we're in comment viewer with all siblings loaded
    await waitForSwipeReady(page, 3);
  });
});

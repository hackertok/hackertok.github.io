import { test, expect } from '@playwright/test';
import { createFirebaseWsHandler, FIREBASE_WS_PATTERN, setupApiMocks } from './fixtures/api-mocks';

test.describe('Item Detail', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('displays item title and metadata', async ({ page }) => {
    await page.goto('/#/item/12345');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.getByText('leerob', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('284 points').first()).toBeVisible();

    await expect(page).toHaveTitle(/Rust Is the Future of JavaScript Infrastructure.*HackerTok/);

    const articleLink = page.getByRole('link', { name: /example\.com/i }).first();
    await expect(articleLink).toHaveAttribute('href', /example\.com/);
  });

  test('displays comments', async ({ page }) => {
    await page.goto('/#/item/12345');

    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });

    // Nested comments are collapsed by default behind "View replies".
    await expect(page.getByText('tptacek').first()).not.toBeVisible();

    await page.getByText(/1 reply/i).first().click();
    await expect(page.getByText('tptacek').first()).toBeVisible();
  });

  test('can expand and collapse replies', async ({ page }) => {
    await page.goto('/#/item/12345');

    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });

    await page.getByText(/1 reply/i).first().click();
    await expect(page.getByText('tptacek').first()).toBeVisible();

    // Trunk line button collapses the whole subtree, not just the immediate child.
    await page.getByRole('button', { name: /collapse replies/i }).first().click();
    await expect(page.getByText('tptacek').first()).not.toBeVisible();
  });

  test('handles item not found', async ({ page }) => {
    // 99999999 returns null in the mock — exercises the not-found branch.
    await page.goto('/#/item/99999999');

    await expect(page.getByText(/not found/i)).toBeVisible();

    await expect(page).toHaveTitle(/(Item|Story) not found.*HackerTok/);

    await expect(page.getByRole('link', { name: /back to home/i })).toBeVisible();

    // URL must NOT silently swap to a different item's id (prevents bait-and-switch).
    expect(page.url()).toContain('99999999');
  });

  test('handles item not found when navigating from existing item', async ({ page }) => {
    await page.goto('/#/item/12345');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page).toHaveTitle(/Rust Is the Future of JavaScript Infrastructure.*HackerTok/);

    await page.goto('/#/item/99999999');

    await expect(page.getByText(/not found/i)).toBeVisible();
    await expect(page).toHaveTitle(/(Item|Story) not found.*HackerTok/);

    // URL must reflect the requested id, not the previously-loaded one.
    expect(page.url()).toContain('99999999');
    expect(page.url()).not.toContain('12345');
  });

  test('renders out-of-feed item when navigating from in-feed item', async ({ page }) => {
    // 12345 is in mockTopItemIds; 99999 has mock data but is NOT in the feed.
    await page.goto('/#/item/12345');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await page.goto('/#/item/99999');

    await expect(page.getByText('Show HN: Piko – Open-Source Ngrok Alternative in Go').first()).toBeVisible();

    expect(page.url()).toContain('99999');
    expect(page.url()).not.toContain('12345');
  });

  test('returns to same item after visiting external link', async ({ page }) => {
    // Intercept the external URL so navigation completes instantly
    // (Mobile Safari times out waiting for real external DNS resolution)
    await page.route('**/example.com/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>External</body></html>' }),
    );

    await page.goto('/#/item/12345');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    const externalLink = page.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' }).first();
    await expect(externalLink).toBeVisible();

    await externalLink.click();

    await page.waitForURL(/example\.com/);

    await page.goBack();

    // Back must restore the same item — viewed-marking on click must not push history.
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    expect(page.url()).toContain('12345');
  });

  test('displays text content for Ask HN posts (no external URL)', async ({ page }) => {
    // 88888 is an Ask HN item — has text body, no URL.
    await page.goto('/#/item/88888');

    await expect(page.getByText('Ask HN: What are you working on?').first()).toBeVisible();

    await expect(page.getByText(/curious what side projects everyone is working on/i)).toBeVisible();

    // Mobile view may render adjacent items with external links, so scope
    // the assertion to the current item's <article>.
    const askHnArticle = page.locator('article').filter({ has: page.getByText('Ask HN: What are you working on?') });

    const titleHeading = askHnArticle.getByRole('heading', { level: 1 });
    await expect(titleHeading).toBeVisible();
    const titleLink = titleHeading.locator('a[href^="http"]');
    await expect(titleLink).toHaveCount(0);
  });
});

test.describe('Item Detail - Deep Nested Comments', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('renders 4-level deep comment nesting', async ({ page }) => {
    await setupApiMocks(page);

    const now = Math.floor(Date.now() / 1000);

    // Flat list of 4 comments linked by parent_id; buildCommentTree
    // reassembles the nesting on the client.
    await page.route('**/search*', async (route) => {
      const url = new URL(route.request().url());
      const tags = url.searchParams.get('tags') || '';

      if (tags.includes('comment') && tags.includes('story_12345')) {
        await route.fulfill({
          json: {
            hits: [
              { objectID: '3001', author: 'level1_user', comment_text: 'Top-level insight', created_at_i: now - 3600, parent_id: 12345, story_id: 12345 },
              { objectID: '3002', author: 'level2_user', comment_text: 'Reply to top-level', created_at_i: now - 3000, parent_id: 3001, story_id: 12345 },
              { objectID: '3003', author: 'level3_user', comment_text: 'Deeply nested thought', created_at_i: now - 2400, parent_id: 3002, story_id: 12345 },
              { objectID: '3004', author: 'level4_user', comment_text: 'Fourth level response', created_at_i: now - 1800, parent_id: 3003, story_id: 12345 },
            ],
            nbHits: 4,
            page: 0,
            nbPages: 1,
            hitsPerPage: 30,
          },
        });
        return;
      }

      await route.continue();
    });

    await page.goto('/#/item/12345');

    // Each level is collapsed; clicking the topmost "1 reply" reveals the next level only.
    await expect(page.getByText('level1_user').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Top-level insight')).toBeVisible();

    await expect(page.getByText('level2_user')).not.toBeVisible();
    await page.getByText(/1 reply/i).first().click();
    await expect(page.getByText('level2_user')).toBeVisible();
    await expect(page.getByText('Reply to top-level')).toBeVisible();

    await expect(page.getByText('level3_user')).not.toBeVisible();
    await page.getByText(/1 reply/i).first().click();
    await expect(page.getByText('level3_user')).toBeVisible();
    await expect(page.getByText('Deeply nested thought')).toBeVisible();

    await expect(page.getByText('level4_user')).not.toBeVisible();
    await page.getByText(/1 reply/i).first().click();
    await expect(page.getByText('level4_user')).toBeVisible();
    await expect(page.getByText('Fourth level response')).toBeVisible();
  });

  test('collapsing a parent hides all nested descendants', async ({ page }) => {
    await setupApiMocks(page);

    const now = Math.floor(Date.now() / 1000);

    await page.route('**/search*', async (route) => {
      const url = new URL(route.request().url());
      const tags = url.searchParams.get('tags') || '';

      if (tags.includes('comment') && tags.includes('story_12345')) {
        await route.fulfill({
          json: {
            hits: [
              { objectID: '3001', author: 'ancestor', comment_text: 'Root comment', created_at_i: now - 3600, parent_id: 12345, story_id: 12345 },
              { objectID: '3002', author: 'child_user', comment_text: 'Child reply', created_at_i: now - 3000, parent_id: 3001, story_id: 12345 },
              { objectID: '3003', author: 'grandchild', comment_text: 'Grandchild reply', created_at_i: now - 2400, parent_id: 3002, story_id: 12345 },
            ],
            nbHits: 3,
            page: 0,
            nbPages: 1,
            hitsPerPage: 30,
          },
        });
        return;
      }

      await route.continue();
    });

    await page.goto('/#/item/12345');
    await expect(page.getByText('ancestor')).toBeVisible({ timeout: 10000 });

    await page.getByText(/1 reply/i).first().click();
    await expect(page.getByText('child_user')).toBeVisible();
    await page.getByText(/1 reply/i).first().click();
    await expect(page.getByText('Grandchild reply')).toBeVisible();

    // Trunk-line collapse must hide the entire subtree, not just the direct child.
    await page.getByRole('button', { name: /collapse replies/i }).first().click();

    await expect(page.getByText('child_user')).not.toBeVisible();
    await expect(page.getByText('Grandchild reply')).not.toBeVisible();
  });
});

test.describe('Item Detail - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('shows full item detail page on desktop', async ({ page }) => {
    await page.goto('/#/item/12345');

    // Mobile-only swipe container must not appear at desktop width.
    const swipeContainer = page.locator('.swipe-snap-container');
    await expect(swipeContainer).not.toBeVisible();

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
  });

  test('back from item detail returns to item list', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    const commentLink = page.getByRole('link', { name: /137.*comments?/i }).first();
    await commentLink.click();

    await expect(page).toHaveURL(/\/item\/12345/);
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await page.goBack();

    await expect(page).toHaveURL(/\/#\/$/);
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.getByText('SQLite Does Not Do Full FSYNC by Default').first()).toBeVisible();
  });
});

const pollItems = {
  126809: { id: 126809, title: 'Poll: Ban Polls?', by: 'pg', score: 46, time: 1204403652, descendants: 0, parts: [126810, 126811], type: 'poll' },
  126810: { id: 126810, text: 'Yes, ban them', by: 'pg', score: 30, time: 1204403652, poll: 126809, type: 'pollopt' },
  126811: { id: 126811, text: 'No, leave them', by: 'pg', score: 10, time: 1204403652, poll: 126809, type: 'pollopt' },
};

test.describe('Item Detail - Poll', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Registered last, so it wins over setupApiMocks' handler.
    await page.routeWebSocket(FIREBASE_WS_PATTERN, createFirebaseWsHandler({ itemOverrides: pollItems }));
  });

  test("lists a poll's options with their points and shares", async ({ page }) => {
    await page.goto('/#/item/126809');

    await expect(page.getByRole('heading', { level: 1, name: 'Poll: Ban Polls?' })).toBeVisible({ timeout: 10_000 });
    const options = page.getByRole('region', { name: 'Poll options' }).getByRole('listitem');
    await expect(options).toHaveText([/Yes, ban them\s*30 points · 75%/, /No, leave them\s*10 points · 25%/]);
  });

  test('shows its options when its comments fail to load', async ({ page }) => {
    await page.route('**/search*', async (route) => {
      const tags = new URL(route.request().url()).searchParams.get('tags') ?? '';
      if (tags.includes('story_126809')) {
        await route.fulfill({ status: 503, json: { message: 'Service temporarily unavailable' } });
        return;
      }
      await route.fallback();
    });

    await page.goto('/#/item/126809');

    await expect(page.getByRole('region', { name: 'Poll options' }).getByRole('listitem')).toHaveCount(2, { timeout: 10_000 });
  });
});

test.describe('Item Detail - Poll option on a phone', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Registered last, so it wins over setupApiMocks' handler.
    await page.routeWebSocket(FIREBASE_WS_PATTERN, createFirebaseWsHandler({ itemOverrides: pollItems }));
  });

  // The swipe viewer only holds stories, so a poll option opens as a page.
  test('opens as a page that links to its poll', async ({ page }) => {
    await page.goto('/#/item/126810');

    await expect(page.getByText('Yes, ban them', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('swipe-container')).toHaveCount(0);

    await page.getByRole('link', { name: 'Poll: Ban Polls?' }).click();
    await expect(page).toHaveURL(/\/item\/126809$/);
    await expect(page.getByRole('region', { name: 'Poll options' }).getByRole('listitem')).toHaveCount(2);
  });
});

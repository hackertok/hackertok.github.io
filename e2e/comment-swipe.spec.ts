import { test, expect } from '@playwright/test';
import { setupApiMocks, FIREBASE_WS_PATTERN, createFirebaseWsHandler } from './fixtures/api-mocks';
import {
  expectActiveSwipePanelText,
  waitForSwipeReady,
  smoothScrollAndAwaitSettled,
  waitForScrollAtIndex,
} from './fixtures/swipe-helpers';

async function getSwipeScrollbarTranslateY(page: Parameters<typeof test>[0]['page']) {
  return page.evaluate(() => {
    const transform = getComputedStyle(document.body, '::after').transform;

    if (!transform || transform === 'none') {
      return 0;
    }

    const match = transform.match(/^matrix(3d)?\((.+)\)$/);
    if (!match) {
      return 0;
    }

    const values = match[2]
      .split(',')
      .map((value) => Number.parseFloat(value.trim()));

    return match[1] === '3d'
      ? (values[13] ?? 0)
      : (values[5] ?? 0);
  });
}

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
    // Regression: comment id MUST NOT redirect to its first sibling. Direct
    // URL access (page.goto) never carries React Router state, so
    // MobileItemResolver has to resolve the type via Firebase — exercises
    // that fallback path.
    await page.goto('/#/item/1001');

    await expectActiveSwipePanelText(page, 'patio11', { timeout: 10000 });

    await expect(page).toHaveURL(/\/item\/1001/, { timeout: 5000 });
  });

  test('shows comment content in swipe viewer on mobile', async ({ page }) => {
    await page.goto('/#/item/1001');

    const swipeContainer = page.getByTestId('swipe-container');
    await expect(swipeContainer).toBeVisible();

    await expectActiveSwipePanelText(page, 'patio11', { timeout: 10000 });

    await expectActiveSwipePanelText(page, /wasm-bindgen/i);
  });

  test('loads sibling comments as swipeable panels', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Parent story 12345 has kids: [1001, 1002, 1003, 1004] → 4 panels.
    await waitForSwipeReady(page, 4);

    const panels = page.getByTestId('swipe-panel');
    await expect(panels).toHaveCount(4);
  });

  test('can swipe to next sibling comment', async ({ page }) => {
    await page.goto('/#/item/1001');

    await waitForSwipeReady(page, 4);

    const container = page.getByTestId('swipe-container');
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });

    await expectActiveSwipePanelText(page, 'jgrahamc', { minPanels: 4, timeout: 10000 });
  });

  test('custom swipe scrollbar moves when document scrolls in comment viewer', async ({ page }) => {
    await page.goto('/#/item/1002');

    await waitForSwipeReady(page, 4);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });

    await page.evaluate(() => {
      const activePanel = document.querySelector('[data-testid="swipe-panel"].active');
      if (activePanel) {
        (activePanel as HTMLElement).style.minHeight = `${window.innerHeight + 1200}px`;
      }
    });

    await expect(async () => {
      const isScrollable = await page.evaluate(() => {
        return document.documentElement.scrollHeight > window.innerHeight;
      });
      expect(isScrollable).toBe(true);
    }).toPass();

    const initialTranslateY = await getSwipeScrollbarTranslateY(page);

    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });

    await expect.poll(
      () => page.evaluate(() => window.scrollY),
      { timeout: 5000 },
    ).toBeGreaterThanOrEqual(250);

    await expect.poll(
      () => getSwipeScrollbarTranslateY(page),
      { timeout: 5000 },
    ).toBeGreaterThan(initialTranslateY + 5);
  });

  test('can swipe through multiple siblings and back', async ({ page }) => {
    await page.goto('/#/item/1001');

    await waitForSwipeReady(page, 4);

    const container = page.getByTestId('swipe-container');
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);

    await smoothScrollAndAwaitSettled(container, width);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });

    await smoothScrollAndAwaitSettled(container, width * 2);
    await waitForScrollAtIndex(page, 2);
    await expect(page).toHaveURL(/\/item\/1003/, { timeout: 5000 });

    await smoothScrollAndAwaitSettled(container, width);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });

    await smoothScrollAndAwaitSettled(container, 0);
    await waitForScrollAtIndex(page, 0);
    await expect(page).toHaveURL(/\/item\/1001/, { timeout: 5000 });
  });

  test('shows parent and story links in comment', async ({ page }) => {
    await page.goto('/#/item/1001');

    await expectActiveSwipePanelText(page, 'patio11', { timeout: 10000 });

    const parentLink = page.getByRole('link', { name: 'parent' }).first();
    await expect(parentLink).toBeVisible();

    await expectActiveSwipePanelText(page, 'Rust Is the Future of JavaScript Infrastructure');
  });

  test('header shows "comments" indicator on mobile comment view', async ({ page }) => {
    await page.goto('/#/item/1001');

    await expectActiveSwipePanelText(page, 'patio11', { timeout: 10000 });

    await expect(page.getByText('comments').first()).toBeVisible();
  });

  test('swipe uses replaceState — no extra history entries', async ({ page }) => {
    await page.goto('/#/item/1001');

    await waitForSwipeReady(page, 4);

    const container = page.getByTestId('swipe-container');
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);

    await smoothScrollAndAwaitSettled(container, width);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });

    await smoothScrollAndAwaitSettled(container, width * 2);
    await waitForScrollAtIndex(page, 2);
    await expect(page).toHaveURL(/\/item\/1003/, { timeout: 5000 });

    // ≤ 2 entries: initial goto + at most one. replaceState (not pushState)
    // is the contract — extra entries would mean history growth on swipe.
    const historyLength = await page.evaluate(() => window.history.length);
    expect(historyLength).toBeLessThanOrEqual(2);
  });

  test('in-panel links have correct hrefs and comments indicator clears when leaving comment view', async ({ page }) => {
    await page.goto('/#/item/1001');

    await expectActiveSwipePanelText(page, 'patio11', { timeout: 10000 });
    await expect(page.getByText('comments').first()).toBeVisible();

    const firstPanel = page.locator('[data-item-id="1001"]');
    const storyLink = firstPanel.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
    await expect(storyLink).toHaveAttribute('href', '#/item/12345');

    const parentLink = firstPanel.getByRole('link', { name: 'parent' });
    await expect(parentLink).toHaveAttribute('href', '#/item/12345');

    // Used to click the header "Best" link, but the responsive packer
    // pushes Best/Show/Ask into a "More" dropdown when the comments pill
    // is active at 375px — and the swipe-viewer focus trap makes that
    // click brittle on Firefox. The actual contract is "leaving comment
    // view clears the indicator"; a hash push exercises it without
    // coupling to header layout.
    await page.evaluate(() => {
      window.location.hash = '#/best';
    });
    // On mobile, the swipe viewer immediately replaces /#/best with /#/item/{id}.
    await expect(page).toHaveURL(/\/#\/(best|item\/)/, { timeout: 5000 });

    await expect(page.getByText('comments', { exact: true })).not.toBeVisible({ timeout: 5000 });
  });

  test('shows "Comment deleted" for dead/deleted comment', async ({ page }) => {
    // Override WS handler to return a dead comment for item 5555
    // and a parent story (12345) with kids: [5555].
    await page.routeWebSocket(FIREBASE_WS_PATTERN, createFirebaseWsHandler({
      itemOverrides: {
        5555: {
          id: 5555,
          by: null,
          text: null,
          time: Math.floor(Date.now() / 1000) - 600,
          parent: 12345,
          type: 'comment',
          dead: true,
        },
        12345: {
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
      },
    }));

    // Algolia: matching deleted comment shape (null author/text).
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

    await page.goto('/#/item/5555');

    await expect(page.getByText('Comment deleted').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows error state when comment fetch fails', async ({ page }) => {
    // Auto-retry exhausts 3 backoff attempts (2+4+8s) before showing error.
    test.setTimeout(60000);
    // Override WS: 99999 is a comment so MobileItemResolver routes to comment view;
    // its parent (88888) returns error so useSiblingComments errors out.
    await page.routeWebSocket(FIREBASE_WS_PATTERN, createFirebaseWsHandler({
      itemOverrides: {
        99999: {
          id: 99999,
          by: 'someone',
          text: 'placeholder',
          time: Math.floor(Date.now() / 1000) - 600,
          parent: 88888,
          type: 'comment',
        },
      },
      errorItemIds: [88888],
    }));

    // Algolia also fails so useCommentDetail can't paper over the parent error.
    await page.route(`**/items/99999`, async (route) => {
      await route.fulfill({ status: 500, json: { error: 'Server Error' } });
    });

    await page.goto('/#/item/99999');

    // 30s timeout covers the 2+4+8s backoff plus slack.
    await expect(page.getByText('Failed to load comments').first()).toBeVisible({ timeout: 30000 });
  });

  test('sets document title to "Comment by {author}" for the current comment', async ({ page }) => {
    await page.goto('/#/item/1001');

    await expectActiveSwipePanelText(page, 'patio11', { timeout: 10000 });

    await expect(page).toHaveTitle(/Comment by patio11/);
  });

  test('clicking item title link navigates to story viewer, not comment viewer', async ({ page }) => {
    await page.goto('/#/item/1001');

    // Scope to the current panel — every sibling has an item title link,
    // which would otherwise trip strict-mode locator resolution.
    const firstPanel = page.locator('[data-item-id="1001"]');
    const storyLink = firstPanel.getByRole('link', { name: /Rust Is the Future/ });
    await expect(storyLink).toBeVisible({ timeout: 10000 });

    await storyLink.click();

    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 10000 });

    // Title pin distinguishes SwipeStoryViewer from SwipeCommentViewer
    // (which would title as "Comment by ...").
    await expect(page).toHaveTitle(/Rust Is the Future|HackerTok/, { timeout: 10000 });

    await expect(page.getByText('Failed to load comments')).not.toBeVisible();
  });

  test('swipe to sibling then click parent navigates to story viewer', async ({ page }) => {
    await page.goto('/#/item/1001');
    await waitForSwipeReady(page, 4);

    const container = page.getByTestId('swipe-container');
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);

    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/1002/, { timeout: 5000 });
    await expectActiveSwipePanelText(page, 'jgrahamc', { minPanels: 4, timeout: 10000 });

    const panel1002 = page.locator('[data-item-id="1002"]');
    await panel1002.getByRole('link', { name: 'parent' }).click();

    await expect(page).toHaveURL(/\/item\/12345/, { timeout: 10000 });
    await expect(page).toHaveTitle(/Rust Is the Future/, { timeout: 10000 });
  });

  test('clicking parent on nested comment navigates to parent comment viewer', async ({ page }) => {
    // 2001 is a reply to 1001 (top-level on story 12345). Its "parent"
    // link must carry isComment: true and land in SwipeCommentViewer for 1001.
    await page.goto('/#/item/2001');

    await expectActiveSwipePanelText(page, 'tptacek', { timeout: 10000 });

    await page.getByRole('link', { name: 'parent' }).click();
    await expect(page).toHaveURL(/\/item\/1001/, { timeout: 10000 });

    // 1001's siblings are [1001, 1002, 1003, 1004] → confirms we're in the
    // comment viewer with the correct sibling set.
    await expectActiveSwipePanelText(page, 'patio11', { minPanels: 4, timeout: 10000 });
    await expect(page).toHaveTitle(/Comment by patio11/);

    await waitForSwipeReady(page, 4);
  });
});

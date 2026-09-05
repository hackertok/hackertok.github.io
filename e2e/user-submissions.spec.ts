import { test, expect } from '@playwright/test';
import { setupApiMocks, stubEmptyUserSubmissions } from './fixtures/api-mocks';
import { ALGOLIA_API } from './fixtures/mock-data';
import {
  expectActiveSwipePanelText,
  waitForSwipeReady,
  smoothScrollAndAwaitSettled,
  waitForScrollAtIndex,
} from './fixtures/swipe-helpers';
import {
  expectLocatorCenteredBetweenChrome,
  setOfflineAndWaitForBar,
} from './fixtures/layout-helpers';

test.describe('User Submissions - Desktop', () => {
  // Desktop viewport — `MobileUserSubmissionsWrapper` falls through to the
  // vertical `UserSubmissions` list here. Mobile is exercised in its own
  // describe further down with the swipe viewer.
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('renders the user\'s stories list', async ({ page }) => {
    await page.goto('/#/submitted/pg');

    // Both fixture stories must render — proves `useUserInfiniteStories`
    // mapped Algolia hits → StoryCards.
    await expect(page.getByText('Beating the Averages')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Hackers and Painters')).toBeVisible();

    // Pin verbatim — catches regressions to wording (e.g. "Stories by").
    await expect(page).toHaveTitle('Submissions by pg | HackerTok');
  });

  test('shows active "user" pill in header on /submitted/:id', async ({ page }) => {
    await page.goto('/#/submitted/pg');

    const userPill = page.locator('header nav span', { hasText: 'user' });
    await expect(userPill).toBeVisible();
    await expect(userPill).toHaveClass(/bg-accent/);

    // Mutual exclusivity — only one contextual pill ever renders. This is
    // the same priority-order guard as the unit tests in `Header.test.tsx`.
    await expect(page.locator('header nav span', { hasText: 'from' })).toHaveCount(0);
    await expect(page.locator('header nav span', { hasText: 'comments' })).toHaveCount(0);
  });

  test('shows empty state when user has no submissions', async ({ page }) => {
    // The default handler returns a synthetic story for any non-pinned user;
    // override BEFORE navigation so the first fetch actually returns 0 hits
    // and the empty-state branch renders.
    await stubEmptyUserSubmissions(page, 'noresults');

    await page.goto('/#/submitted/noresults');

    // Wording is centralized in `formatNoUserSubmissionsTitle` ("by", not
    // "from", because the subject is a person). Pin the exact copy.
    await expect(page.getByText('No submissions found by "noresults"')).toBeVisible({ timeout: 10_000 });

    // Title is set even on empty result — mirrors the domain page so back
    // navigation surfaces a meaningful tab label.
    await expect(page).toHaveTitle('Submissions by noresults | HackerTok');
  });

  test('clicking comments writes fromUser into history.state', async ({ page }) => {
    await page.goto('/#/submitted/pg');

    await expect(page.getByText('Beating the Averages')).toBeVisible({ timeout: 10_000 });

    // First story's comments link — `mockUserStory1` has 187 comments.
    // Native click avoids Playwright's scrollIntoViewIfNeeded corrupting
    // the scrollY captured by onBeforeNavigate → saveScrollPosition.
    await page.getByRole('link', { name: /187 comments/i }).first().evaluate(el => (el as HTMLElement).click());

    await expect(page).toHaveURL(/\/item\/66666/);

    // The whole point of the `fromUser` state field: ItemDetail's back link
    // and the header's "user" pill both depend on it surviving the click.
    const state = await page.evaluate(() =>
      (window.history.state as { usr?: { fromUser?: string; from?: string; fromDomain?: string } } | null)?.usr,
    );
    expect(state?.fromUser).toBe('pg');
    expect(state?.from).toBeUndefined();
    expect(state?.fromDomain).toBeUndefined();

    // "user" pill must stay active across the URL transition — same
    // regression guard as the domain test for `fromDomain`.
    const userPill = page.locator('header nav span', { hasText: 'user' });
    await expect(userPill).toBeVisible();
    await expect(userPill).toHaveClass(/bg-accent/);
  });

  test('shows error state when Algolia returns 503', async ({ page }) => {
    // Auto-retry exhausts 3 backoff attempts (2s+4s+8s ≈ 14s) before the
    // stable error UI surfaces.
    test.setTimeout(60_000);

    await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
      await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
    });

    await page.goto('/#/submitted/pg');

    await expect(page.getByText('Failed to load submissions')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
  });
});

test.describe('User Submissions - User change reset', () => {
  // Desktop-scoped: on mobile, `SwipeUserSubmissionsViewer` is keyed by
  // `username` in `MobileUserSubmissionsWrapper`, so a username change
  // unmounts the old viewer entirely. The reset block in
  // `useUserInfiniteStories` only runs when the same hook instance sees a
  // new `username` prop — that path exists on desktop because
  // `UserSubmissions` is NOT keyed by `username` in App.tsx.
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('resets the list when navigating between two users', async ({ page }) => {
    await page.goto('/#/submitted/pg');
    await expect(page.getByText('Beating the Averages')).toBeVisible({ timeout: 10_000 });

    // Client-side hash change — same as clicking an author byline link from
    // a comment thread. No reload, so `UserSubmissions` stays mounted and
    // the hook re-renders with the new `username` prop.
    await page.evaluate(() => { window.location.hash = '#/submitted/dang'; });

    // The default mock returns a synthetic "Story by dang" for unknown users.
    // The `pg` story must disappear (proves the reset block ran — otherwise
    // the first commit after the prop change would still show pg's stories).
    await expect(page.getByText('Beating the Averages')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Story by dang')).toBeVisible({ timeout: 10_000 });

    // Title reflects the new user — confirms the whole tree re-rendered, not
    // just the data layer (catches a stale-closure regression).
    await expect(page).toHaveTitle('Submissions by dang | HackerTok');
  });
});

test.describe('User Submissions - Mobile Swipe', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('renders swipe viewer for /#/submitted/:id on mobile', async ({ page }) => {
    await page.goto('/#/submitted/pg');

    // Mobile mounts `SwipeUserSubmissionsViewer` (not the desktop list)
    // through `MobileUserSubmissionsWrapper`.
    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();

    await waitForSwipeReady(page, 2);

    await expectActiveSwipePanelText(page, 'Beating the Averages', { minPanels: 2, timeout: 10_000 });
  });

  test('updates URL to /item/:id and carries fromUser state on swipe', async ({ page }) => {
    await page.goto('/#/submitted/pg');

    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();

    // On initial render the viewer replaces /#/submitted/:id with /#/item/:firstId.
    // mockUserStory1 has objectID '66666'.
    await expect(page).toHaveURL(/\/item\/66666/, { timeout: 5_000 });

    // history.state.usr must carry `fromUser` so back-navigation restores
    // the user submissions context (mirrors the `fromDomain` guarantee for
    // the domain swipe viewer).
    const stateAtFirst = await page.evaluate(() =>
      (window.history.state as { usr?: { fromUser?: string } } | null)?.usr,
    );
    expect(stateAtFirst?.fromUser).toBe('pg');

    // Header "user" pill stays visible across the URL rewrite. The same
    // regression that hid "from" briefly when it only checked
    // `pathname.startsWith('/from/')` would have hidden "user" too — the
    // `isUserActive` predicate's `state.fromUser` branch is what catches it.
    const userPill = page.locator('header nav span', { hasText: 'user' });
    await expect(userPill).toBeVisible();
    await expect(userPill).toHaveClass(/bg-accent/);

    await waitForSwipeReady(page, 2);

    // Swipe to the next panel
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);
    await smoothScrollAndAwaitSettled(container, width);
    await waitForScrollAtIndex(page, 1);

    // URL should update to mockUserStory2 (objectID '66667').
    await expect(page).toHaveURL(/\/item\/66667/, { timeout: 5_000 });

    const stateAtSecond = await page.evaluate(() =>
      (window.history.state as { usr?: { fromUser?: string } } | null)?.usr,
    );
    expect(stateAtSecond?.fromUser).toBe('pg');
  });

  test('restores swipe position when navigating back from a not-found item', async ({ page }) => {
    // Pins the `isHistoryNav` extension at SwipeStoryViewer L78 + L344 that
    // recognizes `fromUser` (alongside `from` and `fromDomain`) as a signal
    // to suppress anchoring and restore scroll position on back.
    await page.goto('/#/submitted/pg');

    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();
    await waitForSwipeReady(page, 2);

    // Swipe to index 1 (mockUserStory2, '66667')
    const panelWidth = await container.evaluate((el) => el.getBoundingClientRect().width);
    await smoothScrollAndAwaitSettled(container, panelWidth);
    await waitForScrollAtIndex(page, 1);
    await expect(page).toHaveURL(/\/item\/66667/, { timeout: 5_000 });

    // Hash-navigate to a non-existent item — clears state.fromUser, leaves
    // the swipe viewer's previous history entry intact for goBack to restore.
    await page.evaluate(() => { window.location.hash = '#/item/99999999'; });
    await expect(page.getByText(/not found/i)).toBeVisible();

    await page.goBack();
    await expect(page.getByText(/not found/i)).not.toBeVisible();
    await expect(page).toHaveURL(/\/item\/66667/, { timeout: 5_000 });
    await waitForScrollAtIndex(page, 1);

    // The whole point — fromUser must be restored on the back entry so the
    // swipe viewer remounts in the user-submissions branch, not the
    // resolver branch (which would re-fetch and reset).
    const stateAfterBack = await page.evaluate(() =>
      (window.history.state as { usr?: { fromUser?: string } } | null)?.usr,
    );
    expect(stateAfterBack?.fromUser).toBe('pg');

    // Tolerate brief state transitions after goBack, mirroring the
    // pattern in mobile-swipe.spec.ts.
    await expect.poll(() => container.evaluate(
      (el) => {
        const panels = el.children;
        for (let i = 0; i < panels.length; i++) {
          if (panels[i].classList.contains('active')) return i;
        }
        return -1;
      }
    ), { timeout: 5_000 }).toBe(1);
  });

  test('shows empty state for a user with no submissions on mobile', async ({ page, context }) => {
    await stubEmptyUserSubmissions(page, 'noresults');

    await page.goto('/#/submitted/noresults');

    // The mobile swipe viewer's empty branch surfaces the same copy as the
    // desktop list (centralized in `formatNoUserSubmissionsTitle`).
    await expect(page.getByText('No submissions found by "noresults"')).toBeVisible({ timeout: 10_000 });

    await setOfflineAndWaitForBar(page, context);

    // Mobile empty states use the shared swipe centering helper.
    const stateRoot = page.getByRole('heading', {
      name: 'No submissions found by "noresults"',
    }).locator('xpath=..');
    await expectLocatorCenteredBetweenChrome(stateRoot);
  });

  test('shows error state when Algolia returns 503 on mobile swipe', async ({ page }) => {
    test.setTimeout(60_000);

    await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
      await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
    });

    await page.goto('/#/submitted/pg');

    // Mobile viewer copy is singular ("item") — distinct from the desktop
    // "submissions" copy, so each branch is pinned by its own assertion.
    await expect(page.getByText('Failed to load item', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();

    // Confirm the error UI is rendered inside the swipe viewer's container,
    // not the desktop list's wrapper. Catches a regression that flips
    // `useCanSwipe`, on either of the two questions it asks.
    await expect(page.getByTestId('swipe-container')).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';
import { setupApiMocks, stubNotFoundUser } from './fixtures/api-mocks';
import { waitForSwipeReady } from './fixtures/swipe-helpers';

test.describe('User Profile - Desktop', () => {
  // Desktop viewport — `/user/:id` renders the same `UserProfile` page on
  // both platforms (no mobile swipe variant), but a few assertions below
  // (header pill visibility, "submissions" link click) read more
  // straightforwardly without the mobile header collapse-on-scroll behavior.
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('renders profile with id, karma, account creation date, and about section', async ({ page }) => {
    await page.goto('/#/user/pg');

    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

    // Thousands separator comes from Intl.NumberFormat — locale pinning matters.
    await expect(page.getByText('155,555 karma')).toBeVisible();

    // Visible label uses formatAbsoluteDate; relative ("X years ago") moves
    // to the <time title> tooltip. Fixture's created: 1160418092 is
    // 2006-10-09T20:21:32Z — under UTC + en-US (pinned per-project in
    // playwright.config.ts) this renders deterministically as "October 9, 2006".
    await expect(page.getByText('October 9, 2006')).toBeVisible();

    // About section — sanitized HTML rendered into .comment-content.
    await expect(page.getByText('Bug fixer.')).toBeVisible();
  });

  test('document title reflects the user id (with HackerTok suffix)', async ({ page }) => {
    await page.goto('/#/user/pg');

    // useDocumentTitle in UserProfile passes the bare `profile.id`; the hook
    // appends ' | HackerTok'. Pinning the suffix catches a regression where
    // the title gets double-suffixed or set to a stale string.
    await expect(page).toHaveTitle('pg | HackerTok');
  });

  test('"submissions" metadata link navigates to /#/submitted/:id', async ({ page }) => {
    await page.goto('/#/user/pg');

    const submissions = page.getByRole('link', { name: 'submissions' });
    await expect(submissions).toBeVisible();
    await expect(submissions).toHaveAttribute('href', '#/submitted/pg');

    await submissions.click();
    await expect(page).toHaveURL(/\/#\/submitted\/pg/);

    // "Bug fixer." is unique to the profile's about section — its
    // disappearance confirms we're on the submissions page, not still on profile.
    await expect(page.getByText('Beating the Averages')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Bug fixer.')).not.toBeVisible();
  });

  test('hides all contextual pills on /user/:id (profile is not a feed)', async ({ page }) => {
    await page.goto('/#/user/pg');

    // Profile detail pages are a one-shot "about this user" surface
    // (karma / join date / Submissions link), not a section/feed — so they
    // deliberately do NOT activate any contextual pill. The pill is
    // reserved for the submissions feed (`/submitted/:id`), where it earns
    // its place as a "where am I in the navigation" signal. The unit-test
    // counterpart for this rule lives in `Header.test.tsx`; this case
    // re-asserts it end-to-end so a regression in `deriveHeaderState`'s
    // priority cascade would also surface in the production browser.
    //
    // All three pills are scoped to `header nav span` so byline links to
    // `/user/...` (or any other text containing "user" / "from" /
    // "comments") in the page body never produce a false positive.
    const userPill = page.locator('header nav span', { hasText: 'user' });
    const fromPill = page.locator('header nav span', { hasText: 'from' });
    const commentsPill = page.locator('header nav span', { hasText: 'comments' });

    // Heading paint is the readiness signal — by then the header has
    // definitely committed its render for this route.
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

    await expect(userPill).toHaveCount(0);
    await expect(fromPill).toHaveCount(0);
    await expect(commentsPill).toHaveCount(0);
  });

  test('shows not-found state for an unknown user', async ({ page }) => {
    // Override the user route BEFORE navigation so the first fetch returns
    // null. `setupApiMocks`'s default falls through to a synthesized profile
    // for unknown ids, which would never trigger the not-found branch.
    await stubNotFoundUser(page, 'nope');

    await page.goto('/#/user/nope');

    await expect(page.getByText('User not found')).toBeVisible();
    await expect(page.getByText(/no user with the id "nope" exists/i)).toBeVisible();

    // Action button surfaces a path back to home so the user is not stranded.
    await expect(page.getByRole('link', { name: /return to home/i })).toBeVisible();

    // Document title reflects the error state, mirroring ItemDetail's pattern.
    await expect(page).toHaveTitle('User not found | HackerTok');
  });
});

test.describe('User Profile - Mobile', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('clears swipe-mode after mount on direct /user/:id load', async ({ page }) => {
    // index.html's bootstrap script optimistically adds `swipe-mode` to <html>
    // and <body> for ANY `#/...` route on mobile (the regex
    // `^#\/(show|ask|best|item\/)?` is not end-anchored and the group is
    // optional, so `#/user/pg` matches via the empty-group fallback). That
    // class sets `overflow: hidden` on the body, which would wedge the
    // vertically scrollable profile if nothing cleared it. UserProfile's
    // mount effect imperatively calls `disableSwipeMode()` to unwedge it —
    // this assertion runs AFTER the heading is visible (i.e. after React has
    // hydrated and the effect has fired) so the assertion pins the
    // post-mount state.
    await page.goto('/#/user/pg');

    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

    // Both class targets must clear — html has `overflow: clip`, body has
    // `overflow: hidden`. Either one being stuck blocks vertical scroll.
    await expect(page.locator('html')).not.toHaveClass(/swipe-mode/);
    await expect(page.locator('body')).not.toHaveClass(/swipe-mode/);
  });

  test('removes swipe-mode when navigating from a swipe page to /user/:id', async ({ page }) => {
    // Same regression as above but exercising the client-side navigation
    // path: `/#/` is in active swipe mode (the swipe viewer's
    // ScrollContainerProvider has set `isSwipeMode=true`), and a hash change
    // to `/#/user/pg` must NOT leave `swipe-mode` stuck on the body. This
    // path was the original motivation for the imperative
    // `disableSwipeMode()` call (the bootstrap script's contribution is
    // covered by the test above).
    await page.goto('/#/');
    await waitForSwipeReady(page, 2);
    await expect(page.locator('html')).toHaveClass(/swipe-mode/);

    await page.evaluate(() => { window.location.hash = '#/user/pg'; });

    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

    await expect(page.locator('html')).not.toHaveClass(/swipe-mode/);
    await expect(page.locator('body')).not.toHaveClass(/swipe-mode/);
  });
});

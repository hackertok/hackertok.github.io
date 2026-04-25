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

  test('renders profile with id, karma, account age, and about section', async ({ page }) => {
    await page.goto('/#/user/pg');

    // Username heading (h1)
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

    // Karma value formatted with thousands separator (Intl.NumberFormat)
    await expect(page.getByText('155,555 karma')).toBeVisible();

    // Account age — "created" and "X years ago" are rendered in adjacent
    // <span> + <time> elements (no single element wraps the whole phrase),
    // so each part is asserted separately. The fixture pins `created` to
    // 2006-10-09, so "years ago" is stable across calendar months.
    await expect(page.getByText('created', { exact: false })).toBeVisible();
    await expect(page.getByText(/\d+\s+years? ago/i)).toBeVisible();

    // About section — sanitized HTML rendered into .comment-content
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

    // Sanity: the destination renders the user's stories list, not the
    // profile copy. "Bug fixer." is unique to the profile's about section.
    await expect(page.getByText('Beating the Averages')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Bug fixer.')).not.toBeVisible();
  });

  test('shows active "user" pill in header on /user/:id', async ({ page }) => {
    await page.goto('/#/user/pg');

    // The pill is rendered as a non-clickable <span> (mirrors "from"). Scoped
    // to the header nav so it never collides with byline links to /user/...
    // inside the page body.
    const userPill = page.locator('header nav span', { hasText: 'user' });
    await expect(userPill).toBeVisible();
    await expect(userPill).toHaveClass(/bg-accent/);

    // Other contextual pills are mutually exclusive — comments > user > from.
    const fromPill = page.locator('header nav span', { hasText: 'from' });
    const commentsPill = page.locator('header nav span', { hasText: 'comments' });
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

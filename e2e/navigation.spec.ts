import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import {
  getActiveSwipePanel,
  mountsSwipeViewer,
  waitForScrollAtIndex,
  waitForSwipeReady,
} from './fixtures/swipe-helpers';

const TOP_STORY_TITLE = 'Rust Is the Future of JavaScript Infrastructure';

async function expectTopStoryVisible(page: Page) {
  if (await mountsSwipeViewer(page)) {
    await waitForSwipeReady(page, 1);
    await waitForScrollAtIndex(page, 0);
    await expect(
      getActiveSwipePanel(page).getByRole('link', { name: TOP_STORY_TITLE }),
    ).toBeVisible({ timeout: 10_000 });
    return;
  }

  // A headline is a visible link in either tree, so this branch has to say
  // which one it is in — otherwise a wrong answer above just quietly drops the
  // panel waits and every assertion still passes.
  await expect(page.getByTestId('swipe-container')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: TOP_STORY_TITLE }).first(),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('navigates to Show HN section', async ({ page }) => {
    await page.goto('/#/');

    // On mobile, the swipe viewer auto-rewrites / → /item/<id>. Wait for
    // this replace-navigation to complete so the subsequent click isn't
    // swallowed by WebKit during the transition (Mobile Safari flake).
    if (await mountsSwipeViewer(page)) {
      await page.waitForURL(/\/#\/item\/\d+/, { timeout: 10000 });
    }

    await page.getByRole('link', { name: /show/i }).click();

    // Wait for navigation to fully settle — the "show" link only receives
    // bg-accent after the route resolves to /show (or /item/<id> with
    // state.from="show").
    await expect(page.getByRole('link', { name: 'show', exact: true })).toHaveClass(/bg-accent/, { timeout: 10000 });

    await expect(page.getByText('Show HN: Piko – Open-Source Ngrok Alternative in Go').first()).toBeVisible({ timeout: 10000 });

    await expect(page).toHaveTitle(/Show.*HackerTok|HackerTok/);

    await expect(page.getByRole('link', { name: 'best', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'ask', exact: true })).not.toHaveClass(/bg-accent/);
  });

  test('navigates to Ask HN section', async ({ page }) => {
    await page.goto('/#/');

    // Same mobile stabilization as Show HN test above.
    if (await mountsSwipeViewer(page)) {
      await page.waitForURL(/\/#\/item\/\d+/, { timeout: 10000 });
    }

    await page.getByRole('link', { name: /ask/i }).click();

    // Wait for navigation to fully settle (same pattern as Show HN above).
    await expect(page.getByRole('link', { name: 'ask', exact: true })).toHaveClass(/bg-accent/, { timeout: 10000 });

    await expect(page.getByText('Ask HN: What are you working on?').first()).toBeVisible({ timeout: 10000 });

    await expect(page).toHaveTitle(/Ask.*HackerTok|HackerTok/);

    await expect(page.getByRole('link', { name: 'show', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'best', exact: true })).not.toHaveClass(/bg-accent/);
  });

  test('navigates to Best section', async ({ page }) => {
    await page.goto('/#/');

    await expect(page.locator('header')).toBeVisible();

    // force: true so the click hits the header link rather than an
    // intercepting story card on mobile widths.
    const bestLink = page.getByRole('link', { name: /best/i });
    await bestLink.scrollIntoViewIfNeeded();
    await bestLink.click({ force: true });

    await expect(page).toHaveURL(/\/#\/(best|item\/)/);

    await expect(page).toHaveTitle(/Best.*HackerTok|HackerTok/);

    // Best-specific content (not just URL/title) — guards against a mock leak.
    await expect(page.getByText('The Art of Finishing Projects')).toBeVisible();

    await expect(page.getByRole('link', { name: 'best', exact: true })).toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'ask', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'show', exact: true })).not.toHaveClass(/bg-accent/);
  });

  test('navigates to New section', async ({ page }) => {
    await page.goto('/#/');

    await expect(page.locator('header')).toBeVisible();

    // force: true so the click hits the header link rather than an
    // intercepting story card on mobile widths.
    const newLink = page.getByRole('link', { name: /new/i });
    await newLink.scrollIntoViewIfNeeded();
    await newLink.click({ force: true });

    await expect(page).toHaveURL(/\/#\/(newest|item\/)/);

    await expect(page).toHaveTitle(/New.*HackerTok|HackerTok/);

    // Newest-specific content (not just URL/title) — guards against a mock leak.
    await expect(page.getByText('Just Shipped: A Tiny Static Site Generator in Rust')).toBeVisible();

    await expect(page.getByRole('link', { name: 'new', exact: true })).toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'best', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'ask', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'show', exact: true })).not.toHaveClass(/bg-accent/);
  });

  test('navigates back to Top from other section', async ({ page }) => {
    await page.goto('/#/show');

    const isMobile = await mountsSwipeViewer(page);

    // On mobile, wait for the show swipe-rewrite to settle before clicking.
    if (isMobile) {
      await page.waitForURL(/\/#\/item\/\d+/, { timeout: 10000 });
    }

    await page.getByRole('link', { name: /hackertok/i }).click();

    // On mobile, wait for the top swipe-rewrite to settle (ensures top
    // stories have loaded and replaced the old show content in the DOM).
    if (isMobile) {
      await page.waitForURL(/\/#\/item\/12345/, { timeout: 10000 });
    } else {
      await expect(page).toHaveURL(/\/#\/(item\/\d+)?$/);
    }

    await expectTopStoryVisible(page);
  });

  test('logo click returns to homepage', async ({ page }) => {
    await page.goto('/#/show');

    const logo = page.getByRole('link', { name: /hackertok|hn|logo/i }).first();
    await logo.click();

    await expect(page).toHaveURL(/\/#\/(item\/\d+)?$/);

    // Homepage title is plain "HackerTok" — no section prefix.
    await expect(page).toHaveTitle(/HackerTok/);
  });

  test('browser back button works', async ({ page }) => {
    await page.goto('/#/');
    await expectTopStoryVisible(page);

    const isMobile = await mountsSwipeViewer(page);

    const bestLink = page.getByRole('link', { name: /best/i });
    await bestLink.scrollIntoViewIfNeeded();
    await bestLink.click({ force: true });

    // Wait for the route to actually resolve before going back. A URL check is
    // unreliable on mobile (pre-click URL is already /#/item/:id), so assert the
    // active (bg-accent) "best" tab instead.
    await expect(page.getByRole('link', { name: 'best', exact: true }))
      .toHaveClass(/bg-accent/, { timeout: 10_000 });

    if (isMobile) {
      // Wait for the swipe viewer's /#/best → /#/item/:id replaceState, so goBack()
      // doesn't race a pending replace that overwrites the restored history entry.
      await expect(page).toHaveURL(/\/#\/item\//, { timeout: 10_000 });
    }

    await page.goBack();

    await expect(page).toHaveURL(/\/#\/(item\/\d+)?$/);
    await expectTopStoryVisible(page);
  });

  test('direct URL navigation works', async ({ page }) => {
    await page.goto('/#/ask');

    await expect(page.getByText('Ask HN:', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Navigation - Header Visibility', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

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
  // The transition under test is the width one, so hand the desktop projects a
  // finger: without it these viewports are a narrowed window, which now keeps
  // the list on purpose.
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('switches from desktop list to mobile swipe on resize', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#/');

    await expectTopStoryVisible(page);
    await expect(page.getByTestId('swipe-container')).not.toBeVisible();

    await page.setViewportSize({ width: 375, height: 667 });

    await expect(page.getByTestId('swipe-container')).toBeVisible({ timeout: 5000 });
  });

  test('switches from mobile swipe to desktop list on resize', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/#/');

    await expect(page.getByTestId('swipe-container')).toBeVisible({ timeout: 5000 });

    await page.setViewportSize({ width: 1280, height: 720 });

    await expect(page.getByTestId('swipe-container')).not.toBeVisible({ timeout: 5000 });
    await expectTopStoryVisible(page);
  });

  test('no layout overflow during desktop-to-mobile transition', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#/');
    await expectTopStoryVisible(page);

    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.getByTestId('swipe-container')).toBeVisible({ timeout: 5000 });

    // Catches a regression where a stale desktop layout leaves docWidth > vpWidth.
    const { docWidth, vpWidth } = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      vpWidth: window.innerWidth,
    }));
    expect(docWidth).toBeLessThanOrEqual(vpWidth);
  });

  test('header "More" button toggles in/out as the viewport crosses the packing threshold', async ({ page }) => {
    // Drives the ResizeObserver-backed `usePackedNav` integration end-to-
    // end. The unit suite mocks the hook (no real layout in jsdom), so
    // this is the only place we exercise the actual repacking pipeline:
    // measure → setState → re-derive visible/hidden → re-render.
    //
    // Use /submitted/pg because the User pill at index 0 takes up enough
    // width that even a moderately-narrow viewport pushes feed tabs into
    // the overflow menu. On a wide viewport everything fits, so the More
    // button must be entirely absent (we don't want it leaking into
    // desktop layouts). The pill itself is the readiness signal — its
    // presence is the precondition for the rest of the assertions.

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#/submitted/pg');
    await expect(
      page.locator('header nav span', { hasText: 'user' }),
    ).toBeVisible();

    const moreBtn = page.getByRole('button', { name: 'More tabs' });
    // Wide viewport: User + Best + Show + Ask all fit alongside the logo
    // and theme toggle; no More button is rendered.
    await expect(moreBtn).toHaveCount(0);

    // Shrink to a viewport where the packer has to overflow at least one
    // feed tab. 320×568 ≈ iPhone SE — the smallest viewport we still
    // need to support.
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(moreBtn).toBeVisible({ timeout: 5000 });

    // Grow back to wide → packer re-runs and removes the More button.
    // This is the assertion that catches "stuck overflow" regressions
    // (e.g. forgetting to disconnect the observer or to recompute on a
    // grow event).
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(moreBtn).toHaveCount(0);
  });
});

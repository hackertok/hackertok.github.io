import { test, expect } from '@playwright/test';
import { setupApiMocks, stubEmptyDomainSearch } from './fixtures/api-mocks';
import { ALGOLIA_API } from './fixtures/mock-data';
import { waitForSwipeReady, smoothScrollAndAwaitSettled, waitForScrollAtIndex } from './fixtures/swipe-helpers';

test.describe('Domain Filter', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('displays items filtered by domain', async ({ page }) => {
    await page.goto('/#/from/example.com');
    
    // URL should contain domain
    await expect(page).toHaveURL(/\/#\/from\/example\.com/);

    // Should show domain-filtered item
    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).toBeVisible({ timeout: 10000 });

    // Should indicate which domain is being filtered
    await expect(page.getByText(/example\.com/i).first()).toBeVisible();
  });
});

test.describe('Domain Filter - Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('handles domain with no items', async ({ page }) => {
    await stubEmptyDomainSearch(page, 'unknown-domain.xyz');

    await page.goto('/#/from/unknown-domain.xyz');
    
    // Should show the "No items found" empty state message
    await expect(page.getByText(/No submissions found from.*unknown-domain\.xyz/i)).toBeVisible();
    
    // Document title should reflect the domain
    await expect(page).toHaveTitle(/unknown-domain\.xyz.*HackerTok/);
  });

  test('domain with subdomain works', async ({ page }) => {
    await page.goto('/#/from/blog.example.com');
    
    // Should navigate successfully
    await expect(page).toHaveURL(/\/#\/from\/blog\.example\.com/);
  });
});

test.describe('Domain Filter - Header "from" button', () => {
  // Scoped to desktop viewport because the "stays active after opening a
  // story" and "browser back restores the list" tests below click
  // StoryCard links inside DomainStories, which only renders on desktop —
  // on mobile, SwipeDomainStoryViewer replaces the URL with /#/item/:id
  // before any list card is visible. The earlier "visible + active" and
  // "hidden on non-domain pages" assertions would also hold on mobile
  // (Header's `isFromActive` stays true across the URL rewrite via
  // state.fromDomain), but they are kept here for locality. The mobile
  // rewrite path is covered by "updates URL to /item/:id and carries
  // fromDomain state on swipe" in the Mobile Swipe describe below.
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('shows active "from" button only on domain pages', async ({ page }) => {
    await page.goto('/#/from/example.com');

    // "from" button should appear in the header nav with active styling
    const fromButton = page.locator('header nav span', { hasText: 'from' });
    await expect(fromButton).toBeVisible();
    await expect(fromButton).toHaveClass(/bg-accent/);

    // Other nav links should not be active
    await expect(page.getByRole('link', { name: 'best', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'show', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'ask', exact: true })).not.toHaveClass(/bg-accent/);
  });

  test('"from" button is hidden on non-domain pages', async ({ page }) => {
    const fromButton = page.locator('header nav span', { hasText: 'from' });

    // Not visible on homepage
    await page.goto('/#/');
    await expect(fromButton).toHaveCount(0);

    // Not visible on feed pages
    await page.goto('/#/best');
    await expect(fromButton).toHaveCount(0);
  });

  test('"from" button stays active after opening a story\'s comments from a domain list', async ({ page }) => {
    // Desktop: StoryCard inside DomainStories renders the domain as fromDomain,
    // so the "comments" link carries state.fromDomain instead of state.from.
    // That keeps the header "from" indicator active and prevents a feed tab
    // (e.g. "top") from incorrectly highlighting on the item detail page.
    await page.goto('/#/from/example.com');

    const fromButton = page.locator('header nav span', { hasText: 'from' });
    await expect(fromButton).toBeVisible();

    // The mock response for example.com puts mockDomainItem first, which has
    // 83 comments. Click the comments link on that card to navigate to the
    // item detail page.
    await page
      .getByRole('link', { name: /83 comments/i })
      .first()
      .click();

    await expect(page).toHaveURL(/\/item\/77777/);

    const state = await page.evaluate(() =>
      (window.history.state as { usr?: { from?: string; fromDomain?: string } } | null)?.usr
    );
    expect(state?.fromDomain).toBe('example.com');
    expect(state?.from).toBeUndefined();

    // Indicator should still be visible and highlighted — no feed tab should
    // light up in its place.
    await expect(fromButton).toBeVisible();
    await expect(fromButton).toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'best', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'show', exact: true })).not.toHaveClass(/bg-accent/);
    await expect(page.getByRole('link', { name: 'ask', exact: true })).not.toHaveClass(/bg-accent/);
  });

  test('browser back from /item/:id with fromDomain restores the /from/:domain list', async ({ page }) => {
    // The whole reason `fromDomain` rides along in history state on desktop
    // is so the back button returns the user to the domain list (not the
    // homepage). DomainStories' StoryCard uses pushState (Link default) so
    // there's a real history entry to return to — unlike the mobile swipe
    // viewer which uses replaceState and exits the section on back.
    await page.goto('/#/from/example.com');

    // Wait for the list to render before clicking through.
    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).toBeVisible({ timeout: 10000 });

    await page
      .getByRole('link', { name: /83 comments/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/item\/77777/);

    await page.goBack();

    // Back to the domain list — URL restored, list re-rendered, and the
    // header "from" indicator active again (covers the round-trip, not just
    // the initial render).
    await expect(page).toHaveURL(/\/#\/from\/example\.com/);
    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).toBeVisible();

    const fromButton = page.locator('header nav span', { hasText: 'from' });
    await expect(fromButton).toBeVisible();
    await expect(fromButton).toHaveClass(/bg-accent/);
  });
});

test.describe('Domain Filter - Empty domain', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('shows error with link to home when domain is empty', async ({ page }) => {
    await page.goto('/#/from/');

    // Document title should fall back to default
    await expect(page).toHaveTitle('HackerTok');

    // Should show error message
    await expect(page.getByText('No domain specified')).toBeVisible();

    // Should have a link back to home that works
    const homeLink = page.getByRole('link', { name: /Return to Home/i });
    await expect(homeLink).toBeVisible();
    await homeLink.click();
    // On mobile, swipe viewer immediately replaces /#/ with /#/item/{id}
    await expect(page).toHaveURL(/\/#\/(item\/\d+)?$/);
  });
});

test.describe('Domain Filter - Pagination', () => {
  // Scoped to desktop viewport. Pagination on the domain list page is driven
  // by react-intersection-observer (`useInView`) on a sentinel below the list,
  // which only makes sense for the vertical `DomainStories` list rendered on
  // desktop. On mobile, /#/from/:domain is rendered by the virtualized swipe
  // viewer which loads more items reactively as the user swipes near the end
  // of the list, not via page-bottom intersection.
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('loads more domain items on pagination', async ({ page }) => {
    await page.goto('/#/from/example.com');

    // Page-0 items should be visible (original mockDomainItem is first)
    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).toBeVisible({ timeout: 10000 });

    // The mock returns nbPages: 2, so DomainStories sees hasMore = true.
    // The infinite scroll trigger is within rootMargin (200px) on this viewport,
    // so page 1 auto-loads without manual scrolling.
    await expect(page.getByText('Advanced CSS Grid Techniques for Modern Layouts')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Domain Filter - Domain change reset', () => {
  // Desktop-scoped: on mobile, SwipeDomainStoryViewer is keyed by `domain`
  // in App.tsx, which unmounts the old viewer and mounts a fresh one on
  // every domain change — the new instance initializes cleanly through
  // the hook's lazy useState init, so the `if (prevDomain !== domain)`
  // reset block never runs. DomainStories is NOT keyed and stays mounted
  // across /#/from/:a → /#/from/:b transitions, which is the only browser
  // path that exercises the reset block. (Unit tests pin the branch
  // directly; this pins the wiring between StoryCard's hostname pill and
  // the hook.)
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('resets the list when navigating between two domains', async ({ page }) => {
    await page.goto('/#/from/example.com');
    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).toBeVisible({ timeout: 10000 });

    // Client-side hash change — same mechanism React Router dispatches
    // when StoryCard's hostname pill is clicked to cross-link into a
    // different domain. No page reload, so the DomainStories instance
    // stays mounted and the hook re-renders with a new `domain` prop.
    await page.evaluate(() => { window.location.hash = '#/from/example.org'; });

    // The default mock returns mockDomainItem (URL: https://example.com/…)
    // regardless of the `query` param, so the hook's URL-filter rejects
    // every hit for example.org and we land on the empty state. That
    // state rendering is only possible if the reset block cleared the
    // old `stories` array — otherwise the first commit after the hash
    // change would still show the example.com items.
    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/No submissions found from.*example\.org/i)).toBeVisible({ timeout: 10000 });

    // Document title updating confirms the whole tree re-rendered with
    // the new domain (DomainStories L26). Catches a regression where the
    // hook resets but the component uses a stale closure over the old
    // domain for title/empty-state copy.
    await expect(page).toHaveTitle(/Submissions from example\.org.*HackerTok/);
  });
});

test.describe('Domain Filter - Mobile Swipe', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('renders swipe viewer for domain on mobile', async ({ page }) => {
    await page.goto('/#/from/example.com');

    // Mobile swipe container should render (not the desktop vertical list)
    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();

    // Multiple panels should render — mockDomainItem + 4 clones (5 total)
    await waitForSwipeReady(page, 2);

    // First panel should show the first domain item's title
    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context').first()).toBeVisible({ timeout: 10000 });
  });

  test('updates URL to /item/:id and carries fromDomain state on swipe', async ({ page }) => {
    await page.goto('/#/from/example.com');

    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();

    // On initial render the viewer replaces /#/from/:domain with /#/item/:firstId.
    // mockDomainItem has objectID '77777' (first in the mock response).
    await expect(page).toHaveURL(/\/item\/77777/, { timeout: 5000 });

    // history.state.usr should carry `fromDomain` so bfcache / back-navigation
    // restores the domain context instead of falling through to the resolver.
    const stateAtFirst = await page.evaluate(() =>
      (window.history.state as { usr?: { fromDomain?: string } } | null)?.usr
    );
    expect(stateAtFirst?.fromDomain).toBe('example.com');

    // Header "from" indicator must stay visible across the URL rewrite. The
    // original bug flashed it for a moment then hid it, because isFromActive
    // only checked pathname.startsWith('/from/'). It should now also be true
    // on /item/:id when state.fromDomain is set.
    const fromButton = page.locator('header nav span', { hasText: 'from' });
    await expect(fromButton).toBeVisible();
    await expect(fromButton).toHaveClass(/bg-accent/);

    await waitForSwipeReady(page, 2);

    // Swipe to the next panel
    const width = await container.evaluate((el) => el.getBoundingClientRect().width);
    await smoothScrollAndAwaitSettled(container, width);
    await waitForScrollAtIndex(page, 1);

    // URL should update to the second item. First clone in the mock has objectID '77770'.
    await expect(page).toHaveURL(/\/item\/77770/, { timeout: 5000 });

    // fromDomain state must continue to ride along with each URL update
    const stateAtSecond = await page.evaluate(() =>
      (window.history.state as { usr?: { fromDomain?: string } } | null)?.usr
    );
    expect(stateAtSecond?.fromDomain).toBe('example.com');
  });

  test('shows empty state for unknown domain on mobile', async ({ page }) => {
    await stubEmptyDomainSearch(page, 'unknown-domain.xyz');

    await page.goto('/#/from/unknown-domain.xyz');

    // The mobile swipe viewer's empty branch should render the same copy as
    // the desktop list so UX is consistent and the existing empty-state
    // assertion in "Edge Cases" remains a single source of truth.
    await expect(page.getByText(/No submissions found from.*unknown-domain\.xyz/i)).toBeVisible({ timeout: 10000 });
  });

  // The mobile cold-start error UI lives in a different component than the
  // desktop list (SwipeStoryViewerCore vs DomainStories) with different copy
  // ("Failed to load item" singular vs "Failed to load items" plural) and
  // different surrounding markup (swipe-snap-container). The "Algolia Error
  // Handling" describe below pins the desktop path; these mirror it for the
  // mobile swipe wiring so a regression in either codepath is caught.
  // Auto-retry exhausts 3 backoff attempts (2s+4s+8s ≈ 14s) before showing
  // error UI, hence the per-test timeout override.

  test('shows error state when Algolia returns 503 on mobile swipe', async ({ page }) => {
    test.setTimeout(60000);

    await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
      await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
    });

    await page.goto('/#/from/example.com');

    // Mobile copy is singular ("item") — the desktop test's regex
    // `/Failed to load items/` would not match here, so an exact assertion
    // pins the mobile branch specifically.
    await expect(page.getByText('Failed to load item', { exact: true })).toBeVisible({ timeout: 30000 });
    // Mobile's StateView omits the `description` prop, so the default copy
    // ("We couldn't load this content. Please try again.") renders alongside
    // the action label. Use the button role to disambiguate from that text.
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();

    // Confirm the error UI is rendered inside the swipe viewer's container,
    // not the desktop list's wrapper. Catches a regression that flips the
    // viewport branch (e.g. an `isMobile` change leaking the desktop list
    // into mobile viewports).
    await expect(page.getByTestId('swipe-container')).toBeVisible();
  });

  test('recovers after retry when Algolia temporarily fails on mobile swipe', async ({ page }) => {
    test.setTimeout(60000);

    let shouldFail = true;
    await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
      if (shouldFail) {
        await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
      } else {
        await route.fulfill({
          json: {
            hits: [{
              objectID: '77777',
              title: 'Google Announces Gemini 3.0 with Extended Context',
              url: 'https://example.com/gemini-3',
              author: 'mfiguiere',
              points: 195,
              created_at_i: Math.floor(Date.now() / 1000) - 5400,
              num_comments: 83,
              _tags: ['story'],
            }],
            nbHits: 1,
            page: 0,
            nbPages: 1,
            hitsPerPage: 50,
          },
        });
      }
    });

    await page.goto('/#/from/example.com');

    // Wait for auto-retry to exhaust → stable error state.
    await expect(page.getByText('Failed to load item', { exact: true })).toBeVisible({ timeout: 30000 });
    const retryButton = page.getByRole('button', { name: /try again/i });
    await expect(retryButton).toBeVisible();

    // Flip the mock to succeed before clicking. The retry handler in the
    // swipe viewer is `() => { resetRetry(); void loadMore(); }`; this test
    // pins both halves: resetRetry clears the auto-retry state machine,
    // loadMore re-issues the fetch, the success path clears `error` (via
    // `setError(null)` at the top of loadMore), and stories populate.
    shouldFail = false;
    await retryButton.click();

    // Story renders inside the swipe viewer after recovery. `.first()`
    // because the title may also render in the document title bar.
    await expect(
      page.getByText('Google Announces Gemini 3.0 with Extended Context').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Domain Filter - Algolia Error Handling', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  // Auto-retry exhausts 3 backoff attempts (2s+4s+8s) before showing error
  test.setTimeout(60000);

  test('shows error state when Algolia returns 503', async ({ page }) => {
    await setupApiMocks(page);

    // Override search_by_date to return 503 Service Unavailable
    await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
      await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
    });

    await page.goto('/#/from/example.com');

    // Auto-retry exhausts 3 backoff attempts (2s+4s+8s ≈ 14s), then shows error UI.
    await expect(page.getByText(/Failed to load items/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/try again/i)).toBeVisible();
  });

  test('recovers after retry when Algolia temporarily fails', async ({ page }) => {
    await setupApiMocks(page);

    let shouldFail = true;
    // Fail all requests until we flip the flag after auto-retry exhausts
    await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
      if (shouldFail) {
        await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
      } else {
        await route.fulfill({
          json: {
            hits: [{
              objectID: '77777',
              title: 'Google Announces Gemini 3.0 with Extended Context',
              url: 'https://example.com/gemini-3',
              author: 'mfiguiere',
              points: 195,
              created_at_i: Math.floor(Date.now() / 1000) - 5400,
              num_comments: 83,
              _tags: ['story'],
            }],
            nbHits: 1,
            page: 0,
            nbPages: 1,
            hitsPerPage: 50,
          },
        });
      }
    });

    await page.goto('/#/from/example.com');

    // Wait for auto-retry to fully exhaust (2s+4s+8s ≈ 14s) → stable error state
    await expect(page.getByText(/Failed to load items/)).toBeVisible({ timeout: 30000 });
    const retryButton = page.getByText(/try again/i);
    await expect(retryButton).toBeVisible();

    // Stop failing before clicking retry
    shouldFail = false;
    await retryButton.click();

    // Items should load successfully
    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).toBeVisible({ timeout: 10000 });
  });
});

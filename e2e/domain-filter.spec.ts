import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { ALGOLIA_API } from './fixtures/mock-data';

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
    // Mock empty response for unknown domain
    await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
      const url = new URL(route.request().url());
      const query = url.searchParams.get('query') || '';
      
      if (query.includes('unknown-domain.xyz')) {
        await route.fulfill({
          json: {
            hits: [],
            nbHits: 0,
            page: 0,
            nbPages: 0,
            hitsPerPage: 50,
          },
        });
      } else {
        await route.continue();
      }
    });
    
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

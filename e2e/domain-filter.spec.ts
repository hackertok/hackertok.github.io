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
    await expect(page.getByText(/No stories found from unknown-domain\.xyz/i)).toBeVisible();
    
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

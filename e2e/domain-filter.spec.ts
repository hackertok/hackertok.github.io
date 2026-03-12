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

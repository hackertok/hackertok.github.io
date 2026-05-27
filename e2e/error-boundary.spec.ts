import { test, expect } from '@playwright/test';
import { createFirebaseWsHandler, FIREBASE_WS_PATTERN } from './fixtures/api-mocks';
import { ALGOLIA_API, mockAlgoliaItem1, mockAlgoliaItem2, mockAlgoliaItem3 } from './fixtures/mock-data';

test.describe('Error Boundary', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('displays error UI when a component crashes', async ({ page }) => {
    // Malformed title (object instead of string) makes React throw
    // "Objects are not valid as a React child" when rendering {item.title}.
    await page.routeWebSocket(FIREBASE_WS_PATTERN, createFirebaseWsHandler({
      itemOverrides: {
        12345: {
          id: 12345,
          title: { nested: 'this will crash React render' } as unknown as string,
          url: 'https://example.com',
          by: 'testuser',
          score: 100,
          time: Math.floor(Date.now() / 1000) - 3600,
          descendants: 5,
          type: 'story',
        },
      },
    }));

    await page.route(`${ALGOLIA_API}/search*`, async (route) => {
      await route.fulfill({
        json: {
          hits: [mockAlgoliaItem1, mockAlgoliaItem2, mockAlgoliaItem3],
          nbHits: 3,
          page: 0,
          nbPages: 1,
          hitsPerPage: 30,
        },
      });
    });
    await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
      await route.fulfill({
        json: { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 20 },
      });
    });

    await page.goto('/#/item/12345');

    await expect(page.getByText('Something went wrong')).toBeVisible({ timeout: 10000 });

    const backLink = page.getByRole('link', { name: /back to home/i });
    await expect(backLink).toBeVisible();

    // Recovery link must navigate AND remount the tree past the boundary.
    await backLink.click();
    await expect(page).toHaveURL(/\/#\//);
  });
});

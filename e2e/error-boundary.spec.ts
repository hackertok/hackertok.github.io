import { test, expect } from '@playwright/test';
import { FIREBASE_API, ALGOLIA_API, mockTopStoryIds, mockAlgoliaStory, mockAlgoliaStory2, mockAlgoliaStory3 } from './fixtures/mock-data';

test.describe('Error Boundary', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('displays error UI when a component crashes', async ({ page }) => {
    // Set up mocks that return a malformed story to trigger a React render crash.
    // Making "title" an object causes "Objects are not valid as a React child"
    // when React tries to render {story.title} in the JSX.
    await page.route(`${FIREBASE_API}/topstories.json`, async (route) => {
      await route.fulfill({ json: mockTopStoryIds });
    });
    await page.route(`${FIREBASE_API}/beststories.json`, async (route) => {
      await route.fulfill({ json: [12345] });
    });
    await page.route(`${FIREBASE_API}/item/*.json`, async (route) => {
      const url = route.request().url();
      const match = url.match(/\/item\/(\d+)\.json/);
      const id = match ? parseInt(match[1], 10) : 0;

      // Return a story with title as an object — React will throw during render
      await route.fulfill({
        json: {
          id,
          title: { nested: 'this will crash React render' },
          url: 'https://example.com',
          by: 'testuser',
          score: 100,
          time: Math.floor(Date.now() / 1000) - 3600,
          descendants: 5,
          type: 'story',
        },
      });
    });
    await page.route(`${ALGOLIA_API}/search*`, async (route) => {
      await route.fulfill({
        json: {
          hits: [mockAlgoliaStory, mockAlgoliaStory2, mockAlgoliaStory3],
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

    // Navigate to a story detail page — the malformed title triggers a crash
    await page.goto('/#/item/12345');

    // ErrorBoundary should render its fallback UI
    await expect(page.getByText('Something went wrong')).toBeVisible({ timeout: 10000 });

    // Should show the "Back to Home" recovery link
    const backLink = page.getByRole('link', { name: /back to home/i });
    await expect(backLink).toBeVisible();

    // Clicking "Back to Home" should recover the app
    await backLink.click();
    await expect(page).toHaveURL(/\/#\//);
  });
});

/**
 * Custom Playwright test fixture that provides API mocking helpers.
 * Using fixtures is the recommended pattern per Playwright best practices.
 * @see https://playwright.dev/docs/test-fixtures
 */
import { test as base, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockEmptyItems, mockApiError } from './api-mocks';
import { FIREBASE_API, ALGOLIA_API } from './mock-data';

/**
 * Extended test fixture types
 */
type CustomFixtures = {
  /** Helper to mock empty item responses */
  mockEmpty: () => Promise<void>;
  /** Helper to mock API errors */
  mockError: () => Promise<void>;
  /** Factory for a pre-configured AxeBuilder with consistent tags and excludes */
  makeAxeBuilder: () => AxeBuilder;
  /**
   * Page with error routes pre-configured on browserContext.
   * This fixture sets up routes BEFORE page creation to avoid race conditions
   * where page.route() handlers may not be active by the time of first request.
   */
  errorMockedPage: Page;
};

/**
 * Extended test object with custom fixtures.
 * Import this instead of '@playwright/test' for tests that need API mocking helpers.
 */
export const test = base.extend<CustomFixtures>({
  // Helper fixture for mocking empty responses
  mockEmpty: async ({ page }, use) => {
    const mockFn = async () => {
      await mockEmptyItems(page);
    };
    await use(mockFn);
  },

  // Helper fixture for mocking error responses
  mockError: async ({ page }, use) => {
    const mockFn = async () => {
      await mockApiError(page);
    };
    await use(mockFn);
  },

  /**
   * Fixture that provides a page with error routes already active.
   * Routes are set on browserContext BEFORE page creation, guaranteeing
   * they intercept the very first request during navigation.
   * 
   * This solves the race condition where page.route() might not be ready
   * by the time page.goto() triggers network requests.
   */
  errorMockedPage: async ({ context }, use) => {
    // Set up error routes on context BEFORE page creation
    await context.route(`${FIREBASE_API}/**`, async (route) => {
      await route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
    });
    await context.route(`${ALGOLIA_API}/**`, async (route) => {
      await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
    });

    // Create page AFTER routes are set up
    const page = await context.newPage();
    await use(page);
    // Navigate away before closing to cancel pending JS/network activity,
    // preventing context teardown from exceeding the test timeout
    await page.goto('about:blank');
    await page.close();
  },

  makeAxeBuilder: async ({ page }, use) => {
    await use(() =>
      new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    );
  },
});

// Re-export expect for convenience
export { expect };

import { Page } from '@playwright/test';
import {
  ALGOLIA_API,
  FIREBASE_API,
  mockItem1,
  mockItem2,
  mockItem3,
  mockComment,
  mockNestedComment,
  mockAlgoliaItem1,
  mockAlgoliaItem2,
  mockAlgoliaItem3,
  mockShowHNItem1,
  mockShowHNItem2,
  mockAskHNItem1,
  mockAskHNItem2,
  mockTopItemIds,
  mockBestItemIds,
  mockBestItem1,
  mockBestItem2,
  mockBestItem3,
  mockDomainItem,
  mockPaginationItem1,
  mockPaginationItem2,
  mockPaginationItem3,
  mockAlgoliaCommentItem,
  mockAlgoliaCommentItem1002,
  mockAlgoliaCommentItem1003,
  mockAlgoliaCommentItem2001,
  mockJobItem,
  mockDomainPaginationItem1,
  mockDomainPaginationItem2,
} from './mock-data';

/**
 * Set up all API mocks for E2E tests
 * Intercepts both Algolia and Firebase HN API calls
 */
export async function setupApiMocks(page: Page) {
  // Firebase: Top items
  await page.route(`${FIREBASE_API}/topstories.json`, async (route) => {
    await route.fulfill({ json: mockTopItemIds });
  });

  // Firebase: Best items
  await page.route(`${FIREBASE_API}/beststories.json`, async (route) => {
    await route.fulfill({ json: mockBestItemIds });
  });

  // Firebase: Individual items
  await page.route(`${FIREBASE_API}/item/*.json`, async (route) => {
    const url = route.request().url();
    const match = url.match(/\/item\/(\d+)\.json/);
    const id = match ? parseInt(match[1], 10) : 0;

    // Return null for "not found" test IDs (IDs starting with 0 like 00000 or specific ID 99999999)
    if (id === 99999999 || id === 0) {
      await route.fulfill({ json: null });
      return;
    }

    const items: Record<number, object> = {
      12345: mockItem1,
      12346: mockItem2,
      12347: mockItem3,
      1001: mockComment,
      2001: mockNestedComment,
      // Best items (distinct from top items)
      33001: mockBestItem1,
      33002: mockBestItem2,
      33003: mockBestItem3,
      // Show HN items in Firebase format
      99999: {
        id: 99999,
        title: mockShowHNItem1.title,
        url: mockShowHNItem1.url,
        by: mockShowHNItem1.author,
        score: mockShowHNItem1.points,
        time: mockShowHNItem1.created_at_i,
        descendants: mockShowHNItem1.num_comments,
        type: 'story',
      },
      99998: {
        id: 99998,
        title: mockShowHNItem2.title,
        url: mockShowHNItem2.url,
        by: mockShowHNItem2.author,
        score: mockShowHNItem2.points,
        time: mockShowHNItem2.created_at_i,
        descendants: mockShowHNItem2.num_comments,
        type: 'story',
      },
      // Ask HN items in Firebase format (includes text for text posts)
      88888: {
        id: 88888,
        title: mockAskHNItem1.title,
        url: mockAskHNItem1.url,
        by: mockAskHNItem1.author,
        score: mockAskHNItem1.points,
        time: mockAskHNItem1.created_at_i,
        descendants: mockAskHNItem1.num_comments,
        text: mockAskHNItem1.story_text,
        type: 'story',
      },
      88887: {
        id: 88887,
        title: mockAskHNItem2.title,
        url: mockAskHNItem2.url,
        by: mockAskHNItem2.author,
        score: mockAskHNItem2.points,
        time: mockAskHNItem2.created_at_i,
        descendants: mockAskHNItem2.num_comments,
        type: 'story',
      },
      // Domain item
      77777: {
        id: 77777,
        title: mockDomainItem.title,
        url: mockDomainItem.url,
        by: mockDomainItem.author,
        score: mockDomainItem.points,
        time: mockDomainItem.created_at_i,
        descendants: mockDomainItem.num_comments,
        type: 'story',
      },
      // Job item (not a story — triggers "not a story" error in SwipeStoryViewer)
      55555: mockJobItem,
    };

    if (items[id]) {
      await route.fulfill({ json: items[id] });
    } else if (id === 1002 || id === 1003) {
      // Generic comments
      await route.fulfill({
        json: {
          id,
          by: `user${id}`,
          text: `Comment ${id}`,
          time: Math.floor(Date.now() / 1000) - 600,
          parent: 12345,
          type: 'comment',
        },
      });
    } else {
      // Generic item for unknown IDs
      await route.fulfill({
        json: {
          id,
          title: `Item ${id}`,
          url: `https://example.com/item/${id}`,
          by: 'testuser',
          score: 50,
          time: Math.floor(Date.now() / 1000) - 7200,
          descendants: 5,
          type: 'story',
        },
      });
    }
  });

  // Algolia: Search endpoint
  await page.route(`${ALGOLIA_API}/search*`, async (route) => {
    const url = new URL(route.request().url());
    const tags = url.searchParams.get('tags') || '';
    const query = url.searchParams.get('query') || '';
    const page = parseInt(url.searchParams.get('page') || '0', 10);

    let hits: object[] = [];
    let nbHits = 0;

    // Comments for item detail page (tags=comment,story_12345)
    if (tags.includes('comment') && tags.includes('story_')) {
      // Return mock comments in Algolia format
      hits = [
        {
          objectID: '1001',
          author: 'patio11',
          comment_text: 'The <a href="https://github.com/aspect-build/bazel-lib">wasm-bindgen</a> approach is really interesting. It essentially lets you write Rust that compiles to WebAssembly and then generates <code>JS bindings</code> automatically.',
          created_at_i: Math.floor(Date.now() / 1000) - 1800,
          parent_id: 12345,
          story_id: 12345,
        },
        {
          objectID: '2001',
          author: 'tptacek',
          comment_text: 'Agreed. The DX improvements in the latest release are substantial.',
          created_at_i: Math.floor(Date.now() / 1000) - 900,
          parent_id: 1001,
          story_id: 12345,
        },
        {
          objectID: '1002',
          author: 'jgrahamc',
          comment_text: 'Comment 1002',
          created_at_i: Math.floor(Date.now() / 1000) - 600,
          parent_id: 12345,
          story_id: 12345,
        },
      ];
      nbHits = 3;
    } else if (tags.includes('show_hn')) {
      hits = [mockShowHNItem1, mockShowHNItem2];
      nbHits = 2;
    } else if (tags.includes('ask_hn')) {
      hits = [mockAskHNItem1, mockAskHNItem2];
      nbHits = 2;
    } else if (tags.includes('front_page')) {
      hits = [mockAlgoliaItem1, mockAlgoliaItem2, mockAlgoliaItem3];
      nbHits = 3;
    } else if (tags === 'story') {
      // Day-based pagination (tags=story with numericFilters) - return different items
      hits = [mockPaginationItem1, mockPaginationItem2, mockPaginationItem3];
      nbHits = 3;
    } else if (query.includes('example.com')) {
      // Domain filter
      hits = [mockDomainItem];
      nbHits = 1;
    }

    await route.fulfill({
      json: {
        hits,
        nbHits,
        page,
        nbPages: nbHits > 0 ? 1 : 0,
        hitsPerPage: 30,
      },
    });
  });

  // Algolia: Items endpoint (used for comment detail)
  await page.route(`${ALGOLIA_API}/items/*`, async (route) => {
    const url = route.request().url();
    const match = url.match(/\/items\/(\d+)/);
    const id = match ? parseInt(match[1], 10) : 0;

    const algoliaItems: Record<number, object> = {
      1001: mockAlgoliaCommentItem,
      1002: mockAlgoliaCommentItem1002,
      1003: mockAlgoliaCommentItem1003,
      2001: mockAlgoliaCommentItem2001,
    };

    if (algoliaItems[id]) {
      await route.fulfill({ json: algoliaItems[id] });
      return;
    }

    await route.fulfill({ status: 404, json: { status: 404, error: 'Item not found' } });
  });

  // Algolia: Search by date endpoint (used by DomainStories page for domain-filtered results)
  await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('query') || '';
    const pageNum = parseInt(url.searchParams.get('page') || '0', 10);

    let hits: object[] = [];
    let nbPages = 0;

    if (query) {
      if (pageNum === 0) {
        // Page 0: original item + 4 generated clones (5 total for scrollability)
        hits = [
          mockDomainItem,
          ...Array.from({ length: 4 }, (_, i) => ({
            ...mockDomainItem,
            objectID: String(77770 + i),
            title: `Domain Article ${i + 2}`,
          })),
        ];
        nbPages = 2;
      } else {
        // Page 1: pagination items with unique titles for assertion
        hits = [mockDomainPaginationItem1, mockDomainPaginationItem2];
        nbPages = 2;
      }
    }

    await route.fulfill({
      json: {
        hits,
        nbHits: hits.length,
        page: pageNum,
        nbPages,
        hitsPerPage: 50,
      },
    });
  });
}

/**
 * Mock an empty items response
 */
export async function mockEmptyItems(page: Page) {
  await page.route(`${FIREBASE_API}/topstories.json`, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.route(`${ALGOLIA_API}/search*`, async (route) => {
    await route.fulfill({
      json: {
        hits: [],
        nbHits: 0,
        page: 0,
        nbPages: 0,
        hitsPerPage: 30,
      },
    });
  });
}

/**
 * Mock API error responses
 */
export async function mockApiError(page: Page) {
  await page.route(`${FIREBASE_API}/**`, async (route) => {
    await route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
  });

  await page.route(`${ALGOLIA_API}/**`, async (route) => {
    await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
  });
}

/**
 * Set up API mocks with artificial delay (for testing loading states)
 */
export async function setupApiMocksWithDelay(page: Page, delayMs: number = 1500) {
  // Firebase: Top items with delay
  await page.route(`${FIREBASE_API}/topstories.json`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ json: mockTopItemIds });
  });

  // Firebase: Best items with delay
  await page.route(`${FIREBASE_API}/beststories.json`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ json: mockBestItemIds });
  });

  // Firebase: Individual items with delay
  await page.route(`${FIREBASE_API}/item/*.json`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    const url = route.request().url();
    const match = url.match(/\/item\/(\d+)\.json/);
    const id = match ? parseInt(match[1], 10) : 0;

    const items: Record<number, object> = {
      12345: mockItem1,
      12346: mockItem2,
      12347: mockItem3,
    };

    if (items[id]) {
      await route.fulfill({ json: items[id] });
    } else {
      await route.fulfill({
        json: {
          id,
          title: `Item ${id}`,
          url: `https://example.com/item/${id}`,
          by: 'testuser',
          score: 50,
          time: Math.floor(Date.now() / 1000) - 7200,
          descendants: 5,
          type: 'story',
        },
      });
    }
  });

  // Algolia: Search endpoint with delay
  await page.route(`${ALGOLIA_API}/search*`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
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

  // Algolia: Search by date endpoint with delay
  await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      json: {
        hits: [mockPaginationItem1, mockPaginationItem2, mockPaginationItem3],
        nbHits: 3,
        page: 0,
        nbPages: 1,
        hitsPerPage: 20,
      },
    });
  });
}

import { Page } from '@playwright/test';
import {
  ALGOLIA_API,
  FIREBASE_API,
  mockStory,
  mockStory2,
  mockStory3,
  mockComment,
  mockNestedComment,
  mockAlgoliaStory,
  mockAlgoliaStory2,
  mockAlgoliaStory3,
  mockShowHNStory,
  mockShowHNStory2,
  mockAskHNStory,
  mockAskHNStory2,
  mockTopStoryIds,
  mockBestStoryIds,
  mockBestStory1,
  mockBestStory2,
  mockBestStory3,
  mockDomainStory,
  mockPaginationStory1,
  mockPaginationStory2,
  mockPaginationStory3,
} from './mock-data';

/**
 * Set up all API mocks for E2E tests
 * Intercepts both Algolia and Firebase HN API calls
 */
export async function setupApiMocks(page: Page) {
  // Firebase: Top stories
  await page.route(`${FIREBASE_API}/topstories.json`, async (route) => {
    await route.fulfill({ json: mockTopStoryIds });
  });

  // Firebase: Best stories
  await page.route(`${FIREBASE_API}/beststories.json`, async (route) => {
    await route.fulfill({ json: mockBestStoryIds });
  });

  // Firebase: Individual items (stories and comments)
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
      12345: mockStory,
      12346: mockStory2,
      12347: mockStory3,
      1001: mockComment,
      2001: mockNestedComment,
      // Best stories (distinct from top stories)
      33001: mockBestStory1,
      33002: mockBestStory2,
      33003: mockBestStory3,
      // Show HN stories in Firebase format
      99999: {
        id: 99999,
        title: mockShowHNStory.title,
        url: mockShowHNStory.url,
        by: mockShowHNStory.author,
        score: mockShowHNStory.points,
        time: mockShowHNStory.created_at_i,
        descendants: mockShowHNStory.num_comments,
        type: 'story',
      },
      99998: {
        id: 99998,
        title: mockShowHNStory2.title,
        url: mockShowHNStory2.url,
        by: mockShowHNStory2.author,
        score: mockShowHNStory2.points,
        time: mockShowHNStory2.created_at_i,
        descendants: mockShowHNStory2.num_comments,
        type: 'story',
      },
      // Ask HN stories in Firebase format (includes text for text posts)
      88888: {
        id: 88888,
        title: mockAskHNStory.title,
        url: mockAskHNStory.url,
        by: mockAskHNStory.author,
        score: mockAskHNStory.points,
        time: mockAskHNStory.created_at_i,
        descendants: mockAskHNStory.num_comments,
        text: mockAskHNStory.story_text,
        type: 'story',
      },
      88887: {
        id: 88887,
        title: mockAskHNStory2.title,
        url: mockAskHNStory2.url,
        by: mockAskHNStory2.author,
        score: mockAskHNStory2.points,
        time: mockAskHNStory2.created_at_i,
        descendants: mockAskHNStory2.num_comments,
        type: 'story',
      },
      // Domain story
      77777: {
        id: 77777,
        title: mockDomainStory.title,
        url: mockDomainStory.url,
        by: mockDomainStory.author,
        score: mockDomainStory.points,
        time: mockDomainStory.created_at_i,
        descendants: mockDomainStory.num_comments,
        type: 'story',
      },
    };

    if (items[id]) {
      await route.fulfill({ json: items[id] });
    } else if (id === 1002 || id === 1003) {
      // Generic comments
      await route.fulfill({
        json: {
          id,
          by: `commenter${id}`,
          text: `Comment ${id}`,
          time: Math.floor(Date.now() / 1000) - 600,
          parent: 12345,
          type: 'comment',
        },
      });
    } else {
      // Generic story for unknown IDs
      await route.fulfill({
        json: {
          id,
          title: `Story ${id}`,
          url: `https://example.com/story/${id}`,
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

    // Comments for story detail page (tags=comment,story_12345)
    if (tags.includes('comment') && tags.includes('story_')) {
      // Return mock comments in Algolia format
      hits = [
        {
          objectID: '1001',
          author: 'commenter1',
          comment_text: 'This is a test comment with <code>code</code> in it.',
          created_at_i: Math.floor(Date.now() / 1000) - 1800,
          parent_id: 12345,
          story_id: 12345,
        },
        {
          objectID: '2001',
          author: 'commenter2',
          comment_text: 'This is a nested reply.',
          created_at_i: Math.floor(Date.now() / 1000) - 900,
          parent_id: 1001,
          story_id: 12345,
        },
        {
          objectID: '1002',
          author: 'commenter1002',
          comment_text: 'Comment 1002',
          created_at_i: Math.floor(Date.now() / 1000) - 600,
          parent_id: 12345,
          story_id: 12345,
        },
      ];
      nbHits = 3;
    } else if (tags.includes('show_hn')) {
      hits = [mockShowHNStory, mockShowHNStory2];
      nbHits = 2;
    } else if (tags.includes('ask_hn')) {
      hits = [mockAskHNStory, mockAskHNStory2];
      nbHits = 2;
    } else if (tags.includes('front_page')) {
      hits = [mockAlgoliaStory, mockAlgoliaStory2, mockAlgoliaStory3];
      nbHits = 3;
    } else if (tags === 'story') {
      // Day-based pagination (tags=story with numericFilters) - return different stories
      hits = [mockPaginationStory1, mockPaginationStory2, mockPaginationStory3];
      nbHits = 3;
    } else if (query.includes('example.com')) {
      // Domain filter
      hits = [mockDomainStory];
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

  // Algolia: Search by date endpoint (used by DomainStories page for domain-filtered results)
  await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('query') || '';

    let hits: object[] = [];
    if (query) {
      // Domain filter query (e.g. query=example.com)
      hits = [mockDomainStory];
    }

    await route.fulfill({
      json: {
        hits,
        nbHits: hits.length,
        page: 0,
        nbPages: hits.length > 0 ? 1 : 0,
        hitsPerPage: 20,
      },
    });
  });
}

/**
 * Mock an empty stories response
 */
export async function mockEmptyStories(page: Page) {
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
  // Firebase: Top stories with delay
  await page.route(`${FIREBASE_API}/topstories.json`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ json: mockTopStoryIds });
  });

  // Firebase: Best stories with delay
  await page.route(`${FIREBASE_API}/beststories.json`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ json: mockBestStoryIds });
  });

  // Firebase: Individual items (stories and comments) with delay
  await page.route(`${FIREBASE_API}/item/*.json`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    const url = route.request().url();
    const match = url.match(/\/item\/(\d+)\.json/);
    const id = match ? parseInt(match[1], 10) : 0;

    const items: Record<number, object> = {
      12345: mockStory,
      12346: mockStory2,
      12347: mockStory3,
    };

    if (items[id]) {
      await route.fulfill({ json: items[id] });
    } else {
      await route.fulfill({
        json: {
          id,
          title: `Story ${id}`,
          url: `https://example.com/story/${id}`,
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
        hits: [mockAlgoliaStory, mockAlgoliaStory2, mockAlgoliaStory3],
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
        hits: [mockPaginationStory1, mockPaginationStory2, mockPaginationStory3],
        nbHits: 3,
        page: 0,
        nbPages: 1,
        hitsPerPage: 20,
      },
    });
  });
}

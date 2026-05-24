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
  mockUserProfile,
  mockUserStory1,
  mockUserStory2,
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

    // 99999999 / 0 are reserved as "not found" sentinels in tests.
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
      // Best items use distinct IDs so /best and / serve different data.
      33001: mockBestItem1,
      33002: mockBestItem2,
      33003: mockBestItem3,
      // Firebase shape for Show HN items (Algolia → Firebase translation).
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
      // Ask HN items include `text` (text-only posts have no URL).
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
      // Type=job triggers SwipeStoryViewer's "not a story" error path.
      55555: mockJobItem,
      // User-submitted stories — pinned so desktop tests clicking a
      // comments link from /submitted/pg land on a real-titled /item/:id
      // (not the generic fallback below).
      66666: {
        id: 66666,
        title: mockUserStory1.title,
        url: mockUserStory1.url,
        by: mockUserStory1.author,
        score: mockUserStory1.points,
        time: mockUserStory1.created_at_i,
        descendants: mockUserStory1.num_comments,
        type: 'story',
      },
      66667: {
        id: 66667,
        title: mockUserStory2.title,
        url: mockUserStory2.url,
        by: mockUserStory2.author,
        score: mockUserStory2.points,
        time: mockUserStory2.created_at_i,
        descendants: mockUserStory2.num_comments,
        type: 'story',
      },
    };

    if (items[id]) {
      await route.fulfill({ json: items[id] });
    } else if (id === 1002 || id === 1003) {
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
    } else if (id === 1004) {
      await route.fulfill({
        json: {
          id: 1004,
          by: 'leerob',
          text: 'Author here — thanks for the discussion! I updated the benchmarks section based on feedback.',
          time: Math.floor(Date.now() / 1000) - 300,
          parent: 12345,
          type: 'comment',
        },
      });
    } else {
      // Generic story for unknown IDs so byline/comments-link clicks
      // never 404 in tests that don't pin them.
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

  await page.route(`${ALGOLIA_API}/search*`, async (route) => {
    const url = new URL(route.request().url());
    const tags = url.searchParams.get('tags') || '';
    const page = parseInt(url.searchParams.get('page') || '0', 10);

    let hits: object[] = [];
    let nbHits = 0;

    // tags=comment,story_<id> — comments for an item detail page.
    if (tags.includes('comment') && tags.includes('story_')) {
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
        {
          objectID: '1004',
          author: 'leerob',
          comment_text: 'Author here — thanks for the discussion! I updated the benchmarks section based on feedback.',
          created_at_i: Math.floor(Date.now() / 1000) - 300,
          parent_id: 12345,
          story_id: 12345,
        },
      ];
      nbHits = 4;
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
      // Day-based pagination (tags=story + numericFilters) — distinct items
      // from the 'front_page' branch above so pagination is observable.
      hits = [mockPaginationItem1, mockPaginationItem2, mockPaginationItem3];
      nbHits = 3;
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

  // Algolia: Search by date endpoint. Two callers share this URL:
  //  - `useDomainInfiniteStories` issues `?query=<domain>` (no `tags`)
  //  - `useUserInfiniteStories` issues `?tags=story,author_<username>` (no `query`)
  // The author branch is matched FIRST so the absence of a `tags` substring
  // can never be mis-routed to the domain branch.
  await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
    const url = new URL(route.request().url());
    const tags = url.searchParams.get('tags') || '';
    const query = url.searchParams.get('query') || '';
    const pageNum = parseInt(url.searchParams.get('page') || '0', 10);

    let hits: object[] = [];
    let nbPages = 0;

    if (tags.includes('author_')) {
      // Algolia's `author_X` tag is an exact, server-side author match — every
      // hit is guaranteed to belong to the user. The hook calls
      // `encodeURIComponent` on the username, so decode here to round-trip
      // case-sensitive usernames like `PaulG`.
      const authorMatch = /author_([^,]+)/.exec(tags);
      const author = authorMatch ? decodeURIComponent(authorMatch[1]) : '';

      if (author === 'pg') {
        // Two distinct stories: enough to assert swipe-next URL rewrites and
        // user→user reset behavior without needing pagination plumbing.
        hits = [mockUserStory1, mockUserStory2];
        nbPages = 1;
      } else if (author === 'noresults') {
        // Pinned empty user — exercises the "No submissions found by ..."
        // empty state on both desktop list and mobile swipe viewer without
        // requiring a per-test route override.
        hits = [];
        nbPages = 0;
      } else {
        // Synthetic story for any other author so the user→user reset test
        // (pg → dang) sees a deterministic, distinct title without us having
        // to mint per-user constants in mock-data.ts.
        const safeAuthor = author || 'unknown';
        hits = [{
          objectID: '99000',
          title: `Story by ${safeAuthor}`,
          url: `https://example.com/${safeAuthor}`,
          author: safeAuthor,
          points: 1,
          created_at_i: Math.floor(Date.now() / 1000) - 3600,
          num_comments: 0,
          _tags: ['story'],
        }];
        nbPages = 1;
      }
    } else if (query) {
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

  // Firebase: user profile (`/user/:id.json`)
  // Returns `mockUserProfile` for `pg`, `null` for `nope` (HN's "no such user"
  // signal — `useUserProfile` translates this to NotFoundError → isNotFound=true),
  // and a synthesized profile for everything else so author-byline links from
  // arbitrary fixtures (e.g. `leerob`) don't 404 in tests that don't pin them.
  await page.route(`${FIREBASE_API}/user/*.json`, async (route) => {
    const url = route.request().url();
    const idMatch = /\/user\/([^/]+)\.json/.exec(url);
    const id = idMatch ? decodeURIComponent(idMatch[1]) : '';

    if (id === 'pg') {
      await route.fulfill({ json: mockUserProfile });
      return;
    }

    if (id === 'nope') {
      await route.fulfill({ json: null });
      return;
    }

    await route.fulfill({
      json: {
        id,
        created: 1160418092,
        karma: 1,
        submitted: [],
      },
    });
  });
}

/**
 * Stub the Algolia `search_by_date` endpoint to return an empty result for a
 * specific user (matched by `author_<username>` tag). Any other request is
 * passed through to whatever mock is already installed.
 *
 * Mirrors {@link stubEmptyDomainSearch} so the desktop list and mobile swipe
 * empty-state tests for `/submitted/:id` share the same shape.
 */
export async function stubEmptyUserSubmissions(page: Page, username: string) {
  await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
    const url = new URL(route.request().url());
    const tags = url.searchParams.get('tags') ?? '';
    if (tags.includes(`author_${encodeURIComponent(username)}`)) {
      await route.fulfill({
        json: { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 50 },
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Stub the Firebase `/user/:id.json` endpoint to return `null` for a specific
 * username (HN's "no such user" signal). Any other request is passed through.
 */
export async function stubNotFoundUser(page: Page, username: string) {
  await page.route(`${FIREBASE_API}/user/*.json`, async (route) => {
    const url = route.request().url();
    if (url.includes(`/user/${encodeURIComponent(username)}.json`)) {
      await route.fulfill({ json: null });
    } else {
      await route.continue();
    }
  });
}

/**
 * Stub the Algolia `search_by_date` endpoint to return an empty result for a
 * specific domain query. Any other query is passed through to whatever mock
 * is already installed (e.g. the default handler from {@link setupApiMocks}).
 *
 * Shared by the desktop list and mobile swipe empty-state tests so a single
 * helper owns the empty-response shape.
 */
export async function stubEmptyDomainSearch(page: Page, domain: string) {
  await page.route(`${ALGOLIA_API}/search_by_date*`, async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('query') ?? '';
    if (query.includes(domain)) {
      await route.fulfill({
        json: { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 50 },
      });
    } else {
      await route.continue();
    }
  });
}

/** Mock an empty items response. */
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

/** Mock API error responses (Firebase 500 + Algolia 503). */
export async function mockApiError(page: Page) {
  await page.route(`${FIREBASE_API}/**`, async (route) => {
    await route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
  });

  await page.route(`${ALGOLIA_API}/**`, async (route) => {
    await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
  });
}

/** Set up API mocks with artificial delay so loading states are observable. */
export async function setupApiMocksWithDelay(page: Page, delayMs: number = 1500) {
  await page.route(`${FIREBASE_API}/topstories.json`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ json: mockTopItemIds });
  });

  await page.route(`${FIREBASE_API}/beststories.json`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ json: mockBestItemIds });
  });

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

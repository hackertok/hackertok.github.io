import { Page, WebSocketRoute } from '@playwright/test';
import {
  ALGOLIA_API,
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

/** Firebase RTDB WebSocket URL pattern */
export const FIREBASE_WS_PATTERN = /firebaseio\.com\/\.ws/;

/**
 * Attach Firebase RTDB frame-buffering to a WebSocket route.
 * The Firebase wire protocol sends a frame-count string followed by that many
 * JSON payload strings. This helper reassembles them before invoking `handler`.
 */
function attachFrameBuffering(ws: WebSocketRoute, handler: (raw: string) => void | Promise<void>) {
  let expectedFrames = 0;
  let frameBuffer: string[] = [];

  ws.onMessage(async (message) => {
    if (typeof message !== 'string') return;

    const asNum = parseInt(message, 10);
    if (expectedFrames === 0 && !isNaN(asNum) && String(asNum) === message.trim()) {
      expectedFrames = asNum;
      frameBuffer = [];
      return;
    }

    if (expectedFrames > 0) {
      frameBuffer.push(message);
      if (frameBuffer.length < expectedFrames) return;
      const fullMessage = frameBuffer.join('');
      expectedFrames = 0;
      frameBuffer = [];
      await handler(fullMessage);
    } else {
      await handler(message);
    }
  });
}

/**
 * Build the item lookup table used by the WebSocket mock.
 */
function buildItemsMap(): Record<number, object> {
  return {
    12345: mockItem1,
    12346: mockItem2,
    12347: mockItem3,
    1001: mockComment,
    2001: mockNestedComment,
    33001: mockBestItem1,
    33002: mockBestItem2,
    33003: mockBestItem3,
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
    55555: mockJobItem,
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
}

/**
 * Resolve a Firebase path to mock data.
 * Paths from the SDK have a leading slash: `/v0/topstories`, `/v0/item/12345`, `/v0/user/pg`
 */
function resolveFirebasePath(
  path: string,
  items: Record<number, object>,
  opts?: { userResolver?: (username: string) => object | null },
): unknown {
  // Strip leading slash — the SDK sends `/v0/...` but our constants use `v0/...`
  const p = path.replace(/^\//, '');

  if (p === 'v0/topstories') return mockTopItemIds;
  if (p === 'v0/beststories') return mockBestItemIds;
  if (p === 'v0/showstories') return [99999, 99998];
  if (p === 'v0/askstories') return [88888, 88887];

  const itemMatch = /^v0\/item\/(\d+)$/.exec(p);
  if (itemMatch) {
    const id = parseInt(itemMatch[1], 10);
    if (id === 99999999 || id === 0) return null;
    if (items[id]) return items[id];
    if (id === 1002 || id === 1003) {
      return {
        id,
        by: `user${id}`,
        text: `Comment ${id}`,
        time: Math.floor(Date.now() / 1000) - 600,
        parent: 12345,
        type: 'comment',
      };
    }
    if (id === 1004) {
      return {
        id: 1004,
        by: 'leerob',
        text: 'Author here — thanks for the discussion! I updated the benchmarks section based on feedback.',
        time: Math.floor(Date.now() / 1000) - 300,
        parent: 12345,
        type: 'comment',
      };
    }
    // Generic story fallback
    return {
      id,
      title: `Item ${id}`,
      url: `https://example.com/item/${id}`,
      by: 'testuser',
      score: 50,
      time: Math.floor(Date.now() / 1000) - 7200,
      descendants: 5,
      type: 'story',
    };
  }

  const userMatch = /^v0\/user\/(.+)$/.exec(p);
  if (userMatch) {
    const username = decodeURIComponent(userMatch[1]);
    if (opts?.userResolver) return opts.userResolver(username);
    if (username === 'pg') return mockUserProfile;
    return { id: username, created: 1160418092, karma: 1, submitted: [] };
  }

  return null;
}

/**
 * Handle a Firebase RTDB WebSocket connection. Speaks the Firebase wire protocol:
 * - Server sends handshake: {"t":"c","d":{"t":"h","d":{...}}}
 * - Client sends framed messages: frame-count string, then JSON payload
 * - Server responds to "g" (get) requests: {"t":"d","d":{"r":N,"b":{"s":"ok","d":...}}}
 */
export function createFirebaseWsHandler(opts?: {
  userResolver?: (username: string) => object | null;
  delayMs?: number;
  itemOverrides?: Record<number, object | null>;
  errorItemIds?: number[];
}) {
  const items = { ...buildItemsMap(), ...(opts?.itemOverrides ?? {}) };

  return (ws: WebSocketRoute) => {
    // Send handshake immediately
    const handshake = JSON.stringify({
      t: 'c',
      d: { t: 'h', d: { ts: Date.now(), v: '5', h: 's-mock.firebaseio.com', s: 'mock-session' } },
    });
    ws.send(handshake);

    attachFrameBuffering(ws, async (raw) => {
      await handleClientMessage(raw);
    });

    async function handleClientMessage(raw: string) {
      let msg: { t: string; d: { r?: number; a?: string; b?: { p?: string; q?: unknown } } };
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // Ignore malformed messages
      }

      if (msg.t !== 'd' || !msg.d) return;

      const { r: reqId, a: action, b: body } = msg.d;
      if (action !== 'g' || reqId == null || !body?.p) return;

      if (opts?.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      }

      // Check if this is an item request for an error item
      const pathStr = body.p?.replace(/^\//, '') ?? '';
      const errorItemMatch = /^v0\/item\/(\d+)$/.exec(pathStr);
      if (errorItemMatch && opts?.errorItemIds?.includes(parseInt(errorItemMatch[1], 10))) {
        const errorResponse = JSON.stringify({
          t: 'd',
          d: { r: reqId, b: { s: 'permission_denied', d: 'Simulated error' } },
        });
        ws.send(errorResponse);
        return;
      }

      const data = resolveFirebasePath(body.p, items, { userResolver: opts?.userResolver });
      const response = JSON.stringify({
        t: 'd',
        d: { r: reqId, b: { s: 'ok', d: data } },
      });
      ws.send(response);
    }
  };
}

/**
 * Set up all API mocks for E2E tests.
 * Intercepts Firebase WebSocket connections and Algolia HTTP calls.
 */
export async function setupApiMocks(page: Page) {
  // Firebase: intercept WebSocket connection used by the SDK
  await page.routeWebSocket(FIREBASE_WS_PATTERN, createFirebaseWsHandler());

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
          comment_text: 'The <a href="https://github.com/aspect-build/bazel-lib">wasm-bindgen</a> approach is really interesting. It essentially lets you write Rust that compiles to WebAssembly and then generates <code>JS bindings</code> automatically.<pre>const longCodeLine = "this is a very long line of code that extends well beyond the viewport width to ensure horizontal scrolling is required to see all content";</pre>',
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
 * Stub the Firebase user endpoint to return `null` for a specific username.
 * Must be called AFTER setupApiMocks since routeWebSocket uses LIFO ordering
 * (most recently registered handler wins).
 */
export async function stubNotFoundUser(page: Page, username: string) {
  await page.routeWebSocket(FIREBASE_WS_PATTERN, createFirebaseWsHandler({
    userResolver: (u) => {
      if (u === username) return null;
      if (u === 'pg') return mockUserProfile;
      return { id: u, created: 1160418092, karma: 1, submitted: [] };
    },
  }));
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

/** Mock an empty items response (Firebase returns empty arrays, Algolia returns empty hits). */
export async function mockEmptyItems(page: Page) {
  // Firebase WS mock that returns empty arrays for ranked lists
  await page.routeWebSocket(FIREBASE_WS_PATTERN, (ws: WebSocketRoute) => {
    ws.send(JSON.stringify({
      t: 'c',
      d: { t: 'h', d: { ts: Date.now(), v: '5', h: 's-mock.firebaseio.com', s: 'mock-session' } },
    }));

    attachFrameBuffering(ws, (raw) => {
      let msg: { t: string; d: { r?: number; a?: string; b?: { p?: string } } };
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.t !== 'd' || msg.d?.a !== 'g' || msg.d?.r == null) return;
      // Return empty array for all ranked lists, null for items
      const path = msg.d.b?.p ?? '';
      const data = path.includes('stories') ? [] : null;
      ws.send(JSON.stringify({ t: 'd', d: { r: msg.d.r, b: { s: 'ok', d: data } } }));
    });
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

/** Mock API error responses. Firebase WS responds with errors; Algolia returns 503. */
/**
 * Create a WebSocket handler that sends a handshake then responds to all
 * Firebase get requests with a `permission_denied` error. Shared between
 * page-level {@link mockApiError} and context-level `errorMockedPage` fixture.
 */
export function createErrorWsHandler() {
  return (ws: WebSocketRoute) => {
    ws.send(JSON.stringify({
      t: 'c',
      d: { t: 'h', d: { ts: Date.now(), v: '5', h: 's-mock.firebaseio.com', s: 'mock-session' } },
    }));

    attachFrameBuffering(ws, (raw) => {
      let msg: { t: string; d: { r?: number; a?: string } };
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.t !== 'd' || msg.d?.a !== 'g' || msg.d?.r == null) return;
      // Respond with error status for all get requests
      ws.send(JSON.stringify({ t: 'd', d: { r: msg.d.r, b: { s: 'permission_denied', d: 'Simulated error' } } }));
    });
  };
}

export async function mockApiError(page: Page) {
  await page.routeWebSocket(FIREBASE_WS_PATTERN, createErrorWsHandler());

  await page.route(`${ALGOLIA_API}/**`, async (route) => {
    await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
  });
}

/** Set up API mocks with artificial delay so loading states are observable. */
export async function setupApiMocksWithDelay(page: Page, delayMs: number = 1500) {
  // Firebase WS mock with delay
  await page.routeWebSocket(FIREBASE_WS_PATTERN, createFirebaseWsHandler({ delayMs }));

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

import { http, HttpResponse } from 'msw';
import { ALGOLIA_API, FIREBASE_API } from '../config/api';

// Sample item data
export const mockItem = {
  id: 12345,
  title: 'Rust Is the Future of JavaScript Infrastructure',
  url: 'https://leerob.io/blog/rust',
  by: 'leerob',
  score: 284,
  time: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
  descendants: 137,
  kids: [1001, 1002, 1003],
  type: 'story',
};

export const mockComment = {
  id: 1001,
  by: 'patio11',
  text: 'The wasm-bindgen approach is really interesting. It essentially lets you write Rust that compiles to WebAssembly and then generates <code>JS bindings</code> automatically.',
  time: Math.floor(Date.now() / 1000) - 1800,
  parent: 12345,
  kids: [2001],
  type: 'comment',
};

export const mockNestedComment = {
  id: 2001,
  by: 'tptacek',
  text: 'Agreed. The DX improvements in the latest release are substantial.',
  time: Math.floor(Date.now() / 1000) - 900,
  parent: 1001,
  type: 'comment',
};

// Algolia /items/{id} format for comment with children tree
export const mockAlgoliaCommentItem = {
  id: 1001,
  type: 'comment',
  author: 'patio11',
  text: 'The wasm-bindgen approach is really interesting. It essentially lets you write Rust that compiles to WebAssembly and then generates <code>JS bindings</code> automatically.',
  created_at_i: Math.floor(Date.now() / 1000) - 1800,
  parent_id: 12345,
  story_id: 12345,
  children: [
    {
      id: 2001,
      author: 'tptacek',
      text: 'Agreed. The DX improvements in the latest release are substantial.',
      created_at_i: Math.floor(Date.now() / 1000) - 900,
      parent_id: 1001,
      children: [],
    },
  ],
};

// Normalized item (Algolia format)
export const mockAlgoliaItem1 = {
  objectID: '12345',
  title: 'Rust Is the Future of JavaScript Infrastructure',
  url: 'https://leerob.io/blog/rust',
  author: 'leerob',
  points: 284,
  created_at_i: Math.floor(Date.now() / 1000) - 3600,
  num_comments: 137,
  _tags: ['story', 'front_page'],
};

// Additional front page items (Algolia format)
export const mockAlgoliaItem2 = {
  objectID: '12346',
  title: 'SQLite Does Not Do Full FSYNC by Default',
  url: 'https://sqlite.org/draft/wal.html',
  author: 'ingve',
  points: 198,
  created_at_i: Math.floor(Date.now() / 1000) - 7200,
  num_comments: 73,
  _tags: ['story', 'front_page'],
};

export const mockAlgoliaItem3 = {
  objectID: '12347',
  title: 'Why We Moved from React to htmx',
  url: 'https://htmx.org/essays/react-to-htmx/',
  author: 'carsongross',
  points: 156,
  created_at_i: Math.floor(Date.now() / 1000) - 10800,
  num_comments: 241,
  _tags: ['story', 'front_page'],
};

// Show HN item (Algolia format)
export const mockShowHNItem1 = {
  objectID: '99999',
  title: 'Show HN: My Awesome Project',
  url: 'https://github.com/andydunstall/piko',
  author: 'andydunstall',
  points: 312,
  created_at_i: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
  num_comments: 89,
  _tags: ['story', 'show_hn'],
};

export const mockShowHNItem2 = {
  objectID: '99998',
  title: 'Show HN: Another Cool Demo',
  url: 'https://github.com/opticdev/optic',
  author: 'aidan_cully',
  points: 143,
  created_at_i: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
  num_comments: 47,
  _tags: ['story', 'show_hn'],
};

// Ask HN item (Algolia format) - note: no URL (text posts)
export const mockAskHNItem1 = {
  objectID: '88888',
  title: 'Ask HN: What are you working on?',
  url: null, // Ask HN posts typically have no external URL
  author: 'whoishiring',
  points: 245,
  created_at_i: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
  num_comments: 312,
  _tags: ['story', 'ask_hn'],
};

export const mockAskHNItem2 = {
  objectID: '88887',
  title: 'Ask HN: Best resources to learn Rust?',
  url: null,
  author: 'rustlearner',
  points: 178,
  created_at_i: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
  num_comments: 95,
  _tags: ['story', 'ask_hn'],
};

// Top item IDs
export const mockTopItemIds = [12345, 12346, 12347, 12348, 12349];

export const handlers = [
  // Firebase: Get top items
  http.get(`${FIREBASE_API}/topstories.json`, () => {
    return HttpResponse.json(mockTopItemIds);
  }),

  // Firebase: Get best items
  http.get(`${FIREBASE_API}/beststories.json`, () => {
    return HttpResponse.json(mockTopItemIds);
  }),

  // Firebase: Get individual item
  http.get(`${FIREBASE_API}/item/:id.json`, ({ params }) => {
    const id = parseInt(params.id as string, 10);
    
    if (id === 12345) {
      return HttpResponse.json(mockItem);
    }
    if (id === 1001) {
      return HttpResponse.json(mockComment);
    }
    if (id === 2001) {
      return HttpResponse.json(mockNestedComment);
    }
    if (id === 1002 || id === 1003) {
      return HttpResponse.json({
        id,
        by: id === 1002 ? 'jgrahamc' : 'dang',
        text: id === 1002
          ? 'This is a great point. The performance characteristics of the new compiler are impressive — especially the cold-start times.'
          : 'We discussed this on HN a while back. The context from the original thread is worth reading.',
        time: Math.floor(Date.now() / 1000) - 600,
        parent: 12345,
        type: 'comment',
      });
    }
    
    // Return a generic item for other IDs
    return HttpResponse.json({
      id,
      title: `Item ${id}`,
      url: `https://example.com/item/${id}`,
      by: 'testuser',
      score: 50,
      time: Math.floor(Date.now() / 1000) - 7200,
      descendants: 5,
      type: 'story',
    });
  }),

  // Algolia: Search (used for front page items and show items)
  http.get(`${ALGOLIA_API}/search`, ({ request }) => {
    const url = new URL(request.url);
    const tags = url.searchParams.get('tags');
    const page = parseInt(url.searchParams.get('page') ?? '0', 10);
    
    if (tags?.includes('show_hn')) {
      return HttpResponse.json({
        hits: [mockShowHNItem1, mockShowHNItem2],
        nbHits: 2,
        page: page,
        nbPages: 1,
        hitsPerPage: 30,
      });
    }
    
    if (tags?.includes('ask_hn')) {
      return HttpResponse.json({
        hits: [mockAskHNItem1, mockAskHNItem2],
        nbHits: 2,
        page: page,
        nbPages: 1,
        hitsPerPage: 30,
      });
    }
    
    if (tags?.includes('front_page')) {
      return HttpResponse.json({
        hits: [mockAlgoliaItem1, mockAlgoliaItem2, mockAlgoliaItem3],
        nbHits: 3,
        page: 0,
        nbPages: 1,
        hitsPerPage: 20,
      });
    }

    return HttpResponse.json({
      hits: [],
      nbHits: 0,
      page: 0,
      nbPages: 0,
      hitsPerPage: 20,
    });
  }),

  // Algolia: Search by date (used for historical items)
  http.get(`${ALGOLIA_API}/search_by_date`, ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') ?? '';
    
    return HttpResponse.json({
      hits: query ? [mockAlgoliaItem1] : [],
      nbHits: query ? 1 : 0,
      page: 0,
      nbPages: query ? 1 : 0,
      hitsPerPage: 20,
    });
  }),

  // Algolia: Items endpoint (used for comment detail)
  http.get(`${ALGOLIA_API}/items/:id`, ({ params }) => {
    const id = parseInt(params.id as string, 10);

    if (id === 1001) {
      return HttpResponse.json(mockAlgoliaCommentItem);
    }

    // Return 404 for unknown items
    return HttpResponse.json(
      { status: 404, error: 'Item not found' },
      { status: 404 }
    );
  }),
];

/**
 * Error handlers for testing error states.
 * Use server.use(...errorHandlers.notFound) in tests to override default handlers.
 */
export const errorHandlers = {
  // 404 Not Found for item
  notFound: http.get(`${FIREBASE_API}/item/:id.json`, () => {
    return HttpResponse.json(null);
  }),
  
  // 500 Server Error
  serverError: http.get(`${FIREBASE_API}/item/:id.json`, () => {
    return HttpResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }),
  
  // Network Error (connection failure)
  networkError: http.get(`${FIREBASE_API}/item/:id.json`, () => {
    return HttpResponse.error();
  }),
  
  // Empty items list
  emptyItems: http.get(`${FIREBASE_API}/topstories.json`, () => {
    return HttpResponse.json([]);
  }),
  
  // Algolia API error
  algoliaError: http.get(`${ALGOLIA_API}/search`, () => {
    return HttpResponse.json(
      { message: 'Service temporarily unavailable' },
      { status: 503 }
    );
  }),
};

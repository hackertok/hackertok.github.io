import { http, HttpResponse } from 'msw';
import { ALGOLIA_API, FIREBASE_API } from '../config/api';

// Sample story data
export const mockStory = {
  id: 12345,
  title: 'Test Story Title',
  url: 'https://example.com/article',
  by: 'testuser',
  score: 100,
  time: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
  descendants: 10,
  kids: [1001, 1002, 1003],
  type: 'story',
};

export const mockComment = {
  id: 1001,
  by: 'commenter1',
  text: 'This is a test comment with <code>code</code> in it.',
  time: Math.floor(Date.now() / 1000) - 1800,
  parent: 12345,
  kids: [2001],
  type: 'comment',
};

export const mockNestedComment = {
  id: 2001,
  by: 'commenter2',
  text: 'This is a nested reply.',
  time: Math.floor(Date.now() / 1000) - 900,
  parent: 1001,
  type: 'comment',
};

// Normalized story (Algolia format)
export const mockAlgoliaStory = {
  objectID: '12345',
  title: 'Test Story Title',
  url: 'https://example.com/article',
  author: 'testuser',
  points: 100,
  created_at_i: Math.floor(Date.now() / 1000) - 3600,
  num_comments: 10,
  _tags: ['story', 'front_page'],
};

// Show HN story (Algolia format)
export const mockShowHNStory = {
  objectID: '99999',
  title: 'Show HN: My Awesome Project',
  url: 'https://example.com/show-hn-project',
  author: 'showhnuser',
  points: 150,
  created_at_i: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
  num_comments: 25,
  _tags: ['story', 'show_hn'],
};

export const mockShowHNStory2 = {
  objectID: '99998',
  title: 'Show HN: Another Cool Demo',
  url: 'https://example.com/show-hn-demo',
  author: 'demouser',
  points: 75,
  created_at_i: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
  num_comments: 12,
  _tags: ['story', 'show_hn'],
};

// Ask HN story (Algolia format) - note: no URL (text posts)
export const mockAskHNStory = {
  objectID: '88888',
  title: 'Ask HN: What are you working on?',
  url: null, // Ask HN posts typically have no external URL
  author: 'askhnuser',
  points: 120,
  created_at_i: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
  num_comments: 89,
  _tags: ['story', 'ask_hn'],
};

export const mockAskHNStory2 = {
  objectID: '88887',
  title: 'Ask HN: Best resources to learn Rust?',
  url: null,
  author: 'rustlearner',
  points: 65,
  created_at_i: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
  num_comments: 42,
  _tags: ['story', 'ask_hn'],
};

// Top story IDs
export const mockTopStoryIds = [12345, 12346, 12347, 12348, 12349];

export const handlers = [
  // Firebase: Get top stories
  http.get(`${FIREBASE_API}/topstories.json`, () => {
    return HttpResponse.json(mockTopStoryIds);
  }),

  // Firebase: Get best stories
  http.get(`${FIREBASE_API}/beststories.json`, () => {
    return HttpResponse.json(mockTopStoryIds);
  }),

  // Firebase: Get individual item
  http.get(`${FIREBASE_API}/item/:id.json`, ({ params }) => {
    const id = parseInt(params.id, 10);
    
    if (id === 12345) {
      return HttpResponse.json(mockStory);
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
        by: `commenter${id}`,
        text: `Comment ${id}`,
        time: Math.floor(Date.now() / 1000) - 600,
        parent: 12345,
        type: 'comment',
      });
    }
    
    // Return a generic story for other IDs
    return HttpResponse.json({
      id,
      title: `Story ${id}`,
      url: `https://example.com/story/${id}`,
      by: 'testuser',
      score: 50,
      time: Math.floor(Date.now() / 1000) - 7200,
      descendants: 5,
      type: 'story',
    });
  }),

  // Algolia: Search (used for front page stories and show stories)
  http.get(`${ALGOLIA_API}/search`, ({ request }) => {
    const url = new URL(request.url);
    const tags = url.searchParams.get('tags');
    const page = parseInt(url.searchParams.get('page') || '0', 10);
    
    if (tags?.includes('show_hn')) {
      return HttpResponse.json({
        hits: [mockShowHNStory, mockShowHNStory2],
        nbHits: 2,
        page: page,
        nbPages: 1,
        hitsPerPage: 30,
      });
    }
    
    if (tags?.includes('ask_hn')) {
      return HttpResponse.json({
        hits: [mockAskHNStory, mockAskHNStory2],
        nbHits: 2,
        page: page,
        nbPages: 1,
        hitsPerPage: 30,
      });
    }
    
    if (tags?.includes('front_page')) {
      return HttpResponse.json({
        hits: [mockAlgoliaStory],
        nbHits: 1,
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

  // Algolia: Search by date (used for historical stories)
  http.get(`${ALGOLIA_API}/search_by_date`, ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    
    return HttpResponse.json({
      hits: query ? [mockAlgoliaStory] : [],
      nbHits: query ? 1 : 0,
      page: 0,
      nbPages: query ? 1 : 0,
      hitsPerPage: 20,
    });
  }),
];

/**
 * Error handlers for testing error states.
 * Use server.use(...errorHandlers.notFound) in tests to override default handlers.
 */
export const errorHandlers = {
  // 404 Not Found for story
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
  
  // Empty stories list
  emptyStories: http.get(`${FIREBASE_API}/topstories.json`, () => {
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

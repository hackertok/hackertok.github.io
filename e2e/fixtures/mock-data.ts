/**
 * Mock data for E2E tests
 * Mirrors the data from src/mocks/handlers.js for use with Playwright's page.route()
 */

// API endpoints
export const ALGOLIA_API = 'https://hn.algolia.com/api/v1';
export const FIREBASE_API = 'https://hacker-news.firebaseio.com/v0';

// Helper to get current timestamp
const now = () => Math.floor(Date.now() / 1000);

// Sample story data (Firebase format)
export const mockStory = {
  id: 12345,
  title: 'Test Story Title',
  url: 'https://example.com/article',
  by: 'testuser',
  score: 100,
  time: now() - 3600, // 1 hour ago
  descendants: 10,
  kids: [1001, 1002, 1003],
  type: 'story',
};

export const mockComment = {
  id: 1001,
  by: 'commenter1',
  text: 'This is a test comment with <code>code</code> in it.',
  time: now() - 1800,
  parent: 12345,
  kids: [2001],
  type: 'comment',
};

export const mockNestedComment = {
  id: 2001,
  by: 'commenter2',
  text: 'This is a nested reply.',
  time: now() - 900,
  parent: 1001,
  type: 'comment',
};

// Additional stories for list views
export const mockStory2 = {
  id: 12346,
  title: 'Second Test Story',
  url: 'https://example.com/article2',
  by: 'testuser2',
  score: 85,
  time: now() - 7200,
  descendants: 8,  // Synced with mockAlgoliaStory2.num_comments
  type: 'story',
};

export const mockStory3 = {
  id: 12347,
  title: 'Third Test Story',
  url: 'https://example.com/article3',
  by: 'testuser3',
  score: 72,
  time: now() - 10800,
  descendants: 5,  // Synced with mockAlgoliaStory3.num_comments
  type: 'story',
};

// Normalized story (Algolia format)
export const mockAlgoliaStory = {
  objectID: '12345',
  title: 'Test Story Title',
  url: 'https://example.com/article',
  author: 'testuser',
  points: 100,
  created_at_i: now() - 3600,
  num_comments: 10,
  _tags: ['story', 'front_page'],
};

export const mockAlgoliaStory2 = {
  objectID: '12346',
  title: 'Second Test Story',
  url: 'https://example.com/article2',
  author: 'testuser2',
  points: 85,
  created_at_i: now() - 7200,
  num_comments: 8,  // Synced with src/mocks/handlers.js
  _tags: ['story', 'front_page'],
};

export const mockAlgoliaStory3 = {
  objectID: '12347',
  title: 'Third Test Story',
  url: 'https://example.com/article3',
  author: 'testuser3',
  points: 72,
  created_at_i: now() - 10800,
  num_comments: 5,  // Synced with src/mocks/handlers.js
  _tags: ['story', 'front_page'],
};

// Show HN stories (Algolia format)
export const mockShowHNStory = {
  objectID: '99999',
  title: 'Show HN: My Awesome Project',
  url: 'https://example.com/show-hn-project',
  author: 'showhnuser',
  points: 150,
  created_at_i: now() - 7200,
  num_comments: 25,
  _tags: ['story', 'show_hn'],
};

export const mockShowHNStory2 = {
  objectID: '99998',
  title: 'Show HN: Another Cool Demo',
  url: 'https://example.com/show-hn-demo',
  author: 'demouser',
  points: 75,
  created_at_i: now() - 3600,
  num_comments: 12,
  _tags: ['story', 'show_hn'],
};

// Ask HN stories (Algolia format) - note: no URL (text posts)
export const mockAskHNStory = {
  objectID: '88888',
  title: 'Ask HN: What are you working on?',
  url: null,
  author: 'askhnuser',
  points: 120,
  created_at_i: now() - 7200,
  num_comments: 89,
  _tags: ['story', 'ask_hn'],
  // Text content for Ask HN posts (rendered on story detail page)
  story_text: 'I\'m curious what side projects everyone is working on this month. Share your progress, challenges, and what technologies you\'re using!',
};

export const mockAskHNStory2 = {
  objectID: '88887',
  title: 'Ask HN: Best resources to learn Rust?',
  url: null,
  author: 'rustlearner',
  points: 65,
  created_at_i: now() - 3600,
  num_comments: 42,
  _tags: ['story', 'ask_hn'],
};

// Top story IDs (Firebase format)
export const mockTopStoryIds = [12345, 12346, 12347, 12348, 12349];
export const mockBestStoryIds = [33001, 33002, 33003];

// Best stories (Firebase format) - distinct from top stories
export const mockBestStory1 = {
  id: 33001,
  title: 'Best Story Alpha',
  url: 'https://example.com/best-alpha',
  by: 'bestuser1',
  score: 200,
  time: now() - 3600,
  descendants: 30,
  type: 'story',
};

export const mockBestStory2 = {
  id: 33002,
  title: 'Best Story Beta',
  url: 'https://example.com/best-beta',
  by: 'bestuser2',
  score: 180,
  time: now() - 7200,
  descendants: 22,
  type: 'story',
};

export const mockBestStory3 = {
  id: 33003,
  title: 'Best Story Gamma',
  url: 'https://example.com/best-gamma',
  by: 'bestuser3',
  score: 160,
  time: now() - 10800,
  descendants: 18,
  type: 'story',
};

// Domain-filtered story
export const mockDomainStory = {
  objectID: '77777',
  title: 'Article from Example Domain',
  url: 'https://example.com/domain-article',
  author: 'domainuser',
  points: 88,
  created_at_i: now() - 5400,
  num_comments: 15,
  _tags: ['story'],
};

// Additional stories for pagination/infinite scroll testing (Algolia format)
export const mockPaginationStory1 = {
  objectID: '55551',
  title: 'Pagination Story One',
  url: 'https://example.com/page-story-1',
  author: 'pageuser1',
  points: 45,
  created_at_i: now() - 86400, // 1 day ago
  num_comments: 8,
  _tags: ['story', 'front_page'],
};

export const mockPaginationStory2 = {
  objectID: '55552',
  title: 'Pagination Story Two',
  url: 'https://example.com/page-story-2',
  author: 'pageuser2',
  points: 62,
  created_at_i: now() - 86400,
  num_comments: 12,
  _tags: ['story', 'front_page'],
};

export const mockPaginationStory3 = {
  objectID: '55553',
  title: 'Pagination Story Three',
  url: 'https://example.com/page-story-3',
  author: 'pageuser3',
  points: 38,
  created_at_i: now() - 86400,
  num_comments: 5,
  _tags: ['story', 'front_page'],
};

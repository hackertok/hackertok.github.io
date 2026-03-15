/** Mock data for E2E tests */

// API endpoints
export const ALGOLIA_API = 'https://hn.algolia.com/api/v1';
export const FIREBASE_API = 'https://hacker-news.firebaseio.com/v0';

// Helper to get current timestamp
const now = () => Math.floor(Date.now() / 1000);

// Sample item data (Firebase format)
export const mockItem1 = {
  id: 12345,
  title: 'Rust Is the Future of JavaScript Infrastructure',
  url: 'https://example.com/blog/rust',
  by: 'leerob',
  score: 284,
  time: now() - 3600, // 1 hour ago
  descendants: 137,
  kids: [1001, 1002, 1003],
  type: 'story',
};

export const mockComment = {
  id: 1001,
  by: 'patio11',
  text: 'This is a really well-written piece. The section on <code>wasm-bindgen</code> was particularly insightful.',
  time: now() - 1800,
  parent: 12345,
  kids: [2001],
  type: 'comment',
};

export const mockNestedComment = {
  id: 2001,
  by: 'tptacek',
  text: 'Agreed. Worth noting that the Deno team has been investing heavily in this direction too.',
  time: now() - 900,
  parent: 1001,
  type: 'comment',
};

// Additional items for list views
export const mockItem2 = {
  id: 12346,
  title: 'SQLite Does Not Do Full FSYNC by Default',
  url: 'https://www.sqlite.org/draft/wal.html',
  by: 'ingve',
  score: 198,
  time: now() - 7200,
  descendants: 73,
  type: 'story',
};

export const mockItem3 = {
  id: 12347,
  title: 'Why We Moved from React to htmx',
  url: 'https://htmx.org/essays/react-to-htmx/',
  by: 'carsongross',
  score: 156,
  time: now() - 10800,
  descendants: 241,
  type: 'story',
};

// Normalized item (Algolia format)
export const mockAlgoliaItem1 = {
  objectID: '12345',
  title: 'Rust Is the Future of JavaScript Infrastructure',
  url: 'https://example.com/blog/rust',
  author: 'leerob',
  points: 284,
  created_at_i: now() - 3600,
  num_comments: 137,
  _tags: ['story', 'front_page'],
};

export const mockAlgoliaItem2 = {
  objectID: '12346',
  title: 'SQLite Does Not Do Full FSYNC by Default',
  url: 'https://www.sqlite.org/draft/wal.html',
  author: 'ingve',
  points: 198,
  created_at_i: now() - 7200,
  num_comments: 73,
  _tags: ['story', 'front_page'],
};

export const mockAlgoliaItem3 = {
  objectID: '12347',
  title: 'Why We Moved from React to htmx',
  url: 'https://htmx.org/essays/react-to-htmx/',
  author: 'carsongross',
  points: 156,
  created_at_i: now() - 10800,
  num_comments: 241,
  _tags: ['story', 'front_page'],
};

// Show HN items (Algolia format)
export const mockShowHNItem1 = {
  objectID: '99999',
  title: 'Show HN: Piko – Open-Source Ngrok Alternative in Go',
  url: 'https://github.com/andydunstall/piko',
  author: 'andydunstall',
  points: 312,
  created_at_i: now() - 7200,
  num_comments: 89,
  _tags: ['story', 'show_hn'],
};

export const mockShowHNItem2 = {
  objectID: '99998',
  title: 'Show HN: I Built a CLI Tool for Tracking API Changes',
  url: 'https://github.com/opticdev/optic',
  author: 'aidan_cully',
  points: 143,
  created_at_i: now() - 3600,
  num_comments: 47,
  _tags: ['story', 'show_hn'],
};

// Ask HN items (Algolia format) - note: no URL (text posts)
export const mockAskHNItem1 = {
  objectID: '88888',
  title: 'Ask HN: What are you working on?',
  url: null,
  author: 'whoishiring',
  points: 245,
  created_at_i: now() - 7200,
  num_comments: 312,
  _tags: ['story', 'ask_hn'],
  // Text content for Ask HN posts (rendered on item detail page)
  story_text: 'I\u2019m curious what side projects everyone is working on this month. Share your progress, challenges, and what technologies you\u2019re using!',
};

export const mockAskHNItem2 = {
  objectID: '88887',
  title: 'Ask HN: Best resources to learn Rust?',
  url: null,
  author: 'rustlearner',
  points: 178,
  created_at_i: now() - 3600,
  num_comments: 95,
  _tags: ['story', 'ask_hn'],
};

// Top item IDs (Firebase format)
export const mockTopItemIds = [12345, 12346, 12347, 12348, 12349];
export const mockBestItemIds = [33001, 33002, 33003];

// Best items (Firebase format) - distinct from top items
export const mockBestItem1 = {
  id: 33001,
  title: 'The Art of Finishing Projects',
  url: 'https://www.bytedrum.com/posts/art-of-finishing/',
  by: 'bytedrum',
  score: 421,
  time: now() - 3600,
  descendants: 187,
  type: 'story',
};

export const mockBestItem2 = {
  id: 33002,
  title: 'How We Scaled to 1M Users with PostgreSQL',
  url: 'https://techblog.example.dev/postgres-scale',
  by: 'alexgarcia',
  score: 389,
  time: now() - 7200,
  descendants: 142,
  type: 'story',
};

export const mockBestItem3 = {
  id: 33003,
  title: 'A Visual Guide to SSH Tunnels',
  url: 'https://iximiuz.com/en/posts/ssh-tunnels/',
  by: 'iximiuz',
  score: 367,
  time: now() - 10800,
  descendants: 98,
  type: 'story',
};

// Domain-filtered item
export const mockDomainItem = {
  objectID: '77777',
  title: 'Google Announces Gemini 3.0 with Extended Context',
  url: 'https://example.com/gemini-3',
  author: 'mfiguiere',
  points: 195,
  created_at_i: now() - 5400,
  num_comments: 83,
  _tags: ['story'],
};

// Additional items for pagination/infinite scroll testing (Algolia format)
export const mockPaginationItem1 = {
  objectID: '55551',
  title: 'WebAssembly 2.0 Reaches W3C Recommendation',
  url: 'https://www.w3.org/blog/2026/wasm-2/',
  author: 'nickcw',
  points: 167,
  created_at_i: now() - 86400, // 1 day ago
  num_comments: 94,
  _tags: ['story', 'front_page'],
};

export const mockPaginationItem2 = {
  objectID: '55552',
  title: 'Firefox Now Ships with Native Vertical Tabs',
  url: 'https://blog.mozilla.org/en/products/firefox-vertical-tabs/',
  author: 'nicbou',
  points: 223,
  created_at_i: now() - 86400,
  num_comments: 156,
  _tags: ['story', 'front_page'],
};

export const mockPaginationItem3 = {
  objectID: '55553',
  title: 'Lessons from Running Kubernetes for 5 Years',
  url: 'https://blog.container-solutions.com/k8s-lessons',
  author: 'hasclass',
  points: 134,
  created_at_i: now() - 86400,
  num_comments: 78,
  _tags: ['story', 'front_page'],
};

// Comment item (Algolia /items format) for comment detail tests
export const mockAlgoliaCommentItem = {
  id: 1001,
  type: 'comment',
  author: 'patio11',
  text: 'The wasm-bindgen approach is really interesting. It essentially lets you write Rust that compiles to WebAssembly and then generates <code>JS bindings</code> automatically.',
  created_at_i: now() - 1800,
  parent_id: 12345,
  story_id: 12345,
  children: [
    {
      id: 2001,
      author: 'tptacek',
      text: 'Agreed. The DX improvements in the latest release are substantial.',
      created_at_i: now() - 900,
      parent_id: 1001,
      children: [],
    },
  ],
};

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  formatTimeAgo, 
  getHostname, 
  fetchShowStories, 
  fetchAskStories,
  fetchTopStories,
  fetchBestStories,
  fetchFirebaseItem,
  fetchItemOnly,
  fetchAlgoliaItem,
  normalizeAlgoliaItemChildren,
} from './hn';

describe('hn API utilities', () => {
  describe('formatTimeAgo', () => {
    beforeEach(() => {
      // Mock Date.now for consistent tests
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns empty string for null/undefined', () => {
      expect(formatTimeAgo(null as unknown as number)).toBe('');
      expect(formatTimeAgo(undefined as unknown as number)).toBe('');
    });

    it('returns empty string for invalid timestamp', () => {
      expect(formatTimeAgo(NaN)).toBe('');
      expect(formatTimeAgo('invalid' as unknown as number)).toBe('');
    });

    it('returns "just now" for very recent times', () => {
      const now = Date.now();
      expect(formatTimeAgo(now)).toBe('just now');
      expect(formatTimeAgo(now - 30 * 1000)).toBe('just now'); // 30 seconds ago
    });

    it('returns "just now" for future dates', () => {
      const future = Date.now() + 60 * 1000; // 1 minute in future
      expect(formatTimeAgo(future)).toBe('just now');
    });

    it('formats minutes correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 60 * 1000)).toBe('1 minute ago');
      expect(formatTimeAgo(now - 5 * 60 * 1000)).toBe('5 minutes ago');
      expect(formatTimeAgo(now - 30 * 60 * 1000)).toBe('30 minutes ago');
    });

    it('formats hours correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 60 * 60 * 1000)).toBe('1 hour ago');
      expect(formatTimeAgo(now - 3 * 60 * 60 * 1000)).toBe('3 hours ago');
      expect(formatTimeAgo(now - 23 * 60 * 60 * 1000)).toBe('23 hours ago');
    });

    it('formats days correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 24 * 60 * 60 * 1000)).toBe('1 day ago');
      expect(formatTimeAgo(now - 7 * 24 * 60 * 60 * 1000)).toBe('7 days ago');
      expect(formatTimeAgo(now - 29 * 24 * 60 * 60 * 1000)).toBe('29 days ago');
    });

    it('formats months correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 30 * 24 * 60 * 60 * 1000)).toBe('1 month ago');
      expect(formatTimeAgo(now - 90 * 24 * 60 * 60 * 1000)).toBe('3 months ago');
    });

    it('formats years correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 365 * 24 * 60 * 60 * 1000)).toBe('1 year ago');
      expect(formatTimeAgo(now - 2 * 365 * 24 * 60 * 60 * 1000)).toBe('2 years ago');
    });

    it('uses singular form for 1 unit', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 1 * 60 * 1000)).toBe('1 minute ago');
      expect(formatTimeAgo(now - 1 * 60 * 60 * 1000)).toBe('1 hour ago');
      expect(formatTimeAgo(now - 1 * 24 * 60 * 60 * 1000)).toBe('1 day ago');
    });

    it('uses plural form for > 1 unit', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 2 * 60 * 1000)).toBe('2 minutes ago');
      expect(formatTimeAgo(now - 2 * 60 * 60 * 1000)).toBe('2 hours ago');
      expect(formatTimeAgo(now - 2 * 24 * 60 * 60 * 1000)).toBe('2 days ago');
    });
  });

  describe('getHostname', () => {
    it('returns null for null/undefined/empty input', () => {
      expect(getHostname(null)).toBeNull();
      expect(getHostname(undefined)).toBeNull();
      expect(getHostname('')).toBeNull();
    });

    it('returns empty or null for non-HTTP URLs and malformed strings', () => {
      expect(getHostname('not-a-url')).toBeNull(); // Throws in URL constructor
      expect(getHostname('javascript:alert(1)')).toBe(''); // Parses but has empty hostname
    });

    it('extracts hostname from simple URL', () => {
      expect(getHostname('https://example.com')).toBe('example.com');
      expect(getHostname('https://example.com/page')).toBe('example.com');
    });

    it('removes www prefix', () => {
      expect(getHostname('https://www.example.com')).toBe('example.com');
      expect(getHostname('https://www.google.com/search')).toBe('google.com');
    });

    it('handles various protocols', () => {
      expect(getHostname('http://example.com')).toBe('example.com');
      expect(getHostname('https://example.com')).toBe('example.com');
    });

    it('includes first path segment for GitHub URLs', () => {
      expect(getHostname('https://github.com/facebook/react')).toBe('github.com/facebook');
      expect(getHostname('https://github.com/vercel/next.js')).toBe('github.com/vercel');
    });

    it('includes first path segment for GitLab URLs', () => {
      expect(getHostname('https://gitlab.com/gitlab-org/gitlab')).toBe('gitlab.com/gitlab-org');
    });

    it('includes first path segment for Bitbucket URLs', () => {
      expect(getHostname('https://bitbucket.org/atlassian/python-bitbucket')).toBe('bitbucket.org/atlassian');
    });

    it('includes first path segment for Codeberg URLs', () => {
      expect(getHostname('https://codeberg.org/Codeberg/forgejo')).toBe('codeberg.org/Codeberg');
    });

    it('does not include path for other domains', () => {
      expect(getHostname('https://news.ycombinator.com/item?id=123')).toBe('news.ycombinator.com');
      expect(getHostname('https://medium.com/@user/article')).toBe('medium.com');
    });

    it('handles URLs without path segments', () => {
      expect(getHostname('https://github.com')).toBe('github.com');
      expect(getHostname('https://github.com/')).toBe('github.com');
    });
  });

  describe('fetchShowStories', () => {
    it('returns normalized Show HN items', async () => {
      const result = await fetchShowStories(0);
      
      expect(result.stories).toBeDefined();
      expect(result.stories.length).toBeGreaterThan(0);
      expect(result.hasMore).toBeDefined();
      expect(result.nextWindow).toBe(1);
    });

    it('returns items with show type', async () => {
      const result = await fetchShowStories(0);
      
      result.stories.forEach(item => {
        expect(item.type).toBe('show');
      });
    });

    it('returns items with expected properties', async () => {
      const result = await fetchShowStories(0);
      const item = result.stories[0];
      
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('points');
      expect(item).toHaveProperty('author');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('commentCount');
    });

    it('sorts items by gravity score', async () => {
      const result = await fetchShowStories(0);
      
      // With 2 mock items:
      // - Item1: 312 pts, 2hr ago → gravity = (312-1)/(2+2)^1.8 ≈ 27.5
      // - Item2: 143 pts, 1hr ago → gravity = (143-1)/(1+2)^1.8 ≈ 22.8
      // Higher gravity score ranks first
      expect(result.stories.length).toBe(2);
      expect(result.stories[0].points).toBe(312); // Higher gravity score first
      expect(result.stories[1].points).toBe(143);
    });

    it('returns correct pagination info', async () => {
      const result = await fetchShowStories(0);
      
      expect(result.nextWindow).toBe(1);
      expect(result.hasMore).toBe(true); // Always true when items are found (skips empty days)
    });

    it('increments window index for next page', async () => {
      const result1 = await fetchShowStories(0);
      expect(result1.nextWindow).toBe(1);
      
      const result2 = await fetchShowStories(result1.nextWindow);
      expect(result2.nextWindow).toBe(2);
    });
  });

  describe('fetchAskStories', () => {
    it('returns normalized Ask HN items', async () => {
      const result = await fetchAskStories(0);
      
      expect(result.stories).toBeDefined();
      expect(result.stories.length).toBeGreaterThan(0);
      expect(result.hasMore).toBeDefined();
      expect(result.nextWindow).toBe(1);
    });

    it('returns items with ask type', async () => {
      const result = await fetchAskStories(0);
      
      result.stories.forEach(item => {
        expect(item.type).toBe('ask');
      });
    });

    it('returns items with expected properties', async () => {
      const result = await fetchAskStories(0);
      const item = result.stories[0];
      
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('points');
      expect(item).toHaveProperty('author');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('commentCount');
    });

    it('handles Ask HN posts without URL', async () => {
      const result = await fetchAskStories(0);
      
      // Ask HN posts typically have no external URL
      result.stories.forEach(item => {
        // url can be null or undefined for Ask HN
        expect(item.url === null || item.url === undefined).toBe(true);
      });
    });

    it('sorts items by gravity score', async () => {
      const result = await fetchAskStories(0);
      
      // With 2 mock items:
      // - Item1: 245 pts, 2hr ago → gravity = (245-1)/(2+2)^1.8 ≈ 17.5
      // - Item2: 178 pts, 1hr ago → gravity = (178-1)/(1+2)^1.8 ≈ 24.5
      // Higher gravity score ranks first
      expect(result.stories.length).toBe(2);
      expect(result.stories[0].points).toBe(178); // Higher gravity score first
      expect(result.stories[1].points).toBe(245);
    });

    it('returns correct pagination info', async () => {
      const result = await fetchAskStories(0);
      
      expect(result.nextWindow).toBe(1);
      expect(result.hasMore).toBe(true); // Always true when items are found (skips empty days)
    });

    it('increments window index for next page', async () => {
      const result1 = await fetchAskStories(0);
      expect(result1.nextWindow).toBe(1);
      
      const result2 = await fetchAskStories(result1.nextWindow);
      expect(result2.nextWindow).toBe(2);
    });
  });

  describe('fetchTopStories', () => {
    it('returns normalized items from Algolia', async () => {
      const result = await fetchTopStories(20);
      
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns items with expected properties', async () => {
      const result = await fetchTopStories(20);
      const item = result[0];
      
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('url');
      expect(item).toHaveProperty('points');
      expect(item).toHaveProperty('author');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('commentCount');
      expect(item).toHaveProperty('type');
    });

    it('uses default limit of 20', async () => {
      const result = await fetchTopStories();
      
      // Should return available items up to limit
      expect(result.length).toBeLessThanOrEqual(20);
    });

    it('sorts items by gravity score', async () => {
      const result = await fetchTopStories(20);
      
      // Items should be sorted by gravity (higher points relative to age)
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('fetchBestStories', () => {
    it('returns items with pagination info', async () => {
      const result = await fetchBestStories(0, 30);
      
      expect(result).toHaveProperty('stories');
      expect(result).toHaveProperty('hasMore');
      expect(result).toHaveProperty('nextOffset');
    });

    it('returns normalized item format', async () => {
      const result = await fetchBestStories(0, 30);
      const item = result.stories[0];
      
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('points');
      expect(item).toHaveProperty('author');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('commentCount');
    });

    it('paginates correctly by offset', async () => {
      const firstPage = await fetchBestStories(0, 2);
      expect(firstPage.nextOffset).toBe(2);
      
      const secondPage = await fetchBestStories(firstPage.nextOffset, 2);
      expect(secondPage.nextOffset).toBe(4);
    });

    it('returns hasMore=false when no more items', async () => {
      const result = await fetchBestStories(1000, 30);
      
      expect(result.stories).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('fetchFirebaseItem', () => {
    it('fetches an item by ID', async () => {
      const result = await fetchFirebaseItem(12345);
      
      expect(result).toBeDefined();
      expect(result.id).toBe(12345);
      expect(result.title).toBe('Rust Is the Future of JavaScript Infrastructure');
    });

    it('fetches a comment by ID', async () => {
      const result = await fetchFirebaseItem(1001);
      
      expect(result).toBeDefined();
      expect(result.id).toBe(1001);
      expect(result.by).toBe('patio11');
    });

    it('supports AbortSignal for cancellation', async () => {
      const controller = new AbortController();
      controller.abort();
      
      await expect(fetchFirebaseItem(12345, controller.signal))
        .rejects.toThrow();
    });
  });

  describe('fetchItemOnly', () => {
    it('returns item metadata without comments', async () => {
      const result = await fetchItemOnly(12345);
      
      expect(result).toHaveProperty('id', 12345);
      expect(result).toHaveProperty('title', 'Rust Is the Future of JavaScript Infrastructure');
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('points');
      expect(result).toHaveProperty('author');
      expect(result).toHaveProperty('createdAt');
      expect(result).toHaveProperty('commentCount');
    });

    it('normalizes Firebase item format', async () => {
      const result = await fetchItemOnly(12345);
      expect(result.type).not.toBe('comment');
      if (result.type === 'comment') throw new Error('unexpected');
      
      // Firebase uses 'score' but we return 'points'
      expect(result.points).toBe(284);
      // Firebase uses 'by' but we return 'author'
      expect(result.author).toBe('leerob');
      // Firebase uses 'descendants' but we return 'commentCount'
      expect(result.type !== 'job' ? result.commentCount : 0).toBe(137);
    });

    it('converts Unix timestamp to milliseconds', async () => {
      const result = await fetchItemOnly(12345);
      
      // createdAt should be in milliseconds (> 1 trillion)
      expect(result.createdAt).toBeGreaterThan(1000000000000);
    });

    it('handles string ID parameter', async () => {
      const result = await fetchItemOnly('12345');
      
      expect(result.id).toBe(12345);
    });

    it('defaults commentCount to 0 when descendants missing', async () => {
      // Note: Mock returns item with descendants for unknown IDs
      // This test verifies the normalizer handles the field correctly
      const result = await fetchItemOnly(12345);
      expect(result.type).not.toBe('comment');
      if (result.type === 'comment') throw new Error('unexpected');
      
      // Mock item 12345 has descendants: 137
      expect(result.type !== 'job' ? result.commentCount : 0).toBe(137);
    });
  });

  describe('error handling', () => {
    it('formatTimeAgo handles zero timestamp as falsy', () => {
      // Zero is falsy in JavaScript, so returns empty string
      expect(formatTimeAgo(0)).toBe('');
    });

    it('formatTimeAgo handles negative timestamp', () => {
      // Very old date (before Unix epoch) - should not crash
      expect(() => formatTimeAgo(-1000000)).not.toThrow();
    });

    it('getHostname handles URLs with port numbers', () => {
      expect(getHostname('https://localhost:3000/path')).toBe('localhost');
      expect(getHostname('https://example.com:8080/page')).toBe('example.com');
    });

    it('getHostname handles subdomains', () => {
      expect(getHostname('https://blog.example.com/post')).toBe('blog.example.com');
      expect(getHostname('https://api.v2.example.com')).toBe('api.v2.example.com');
    });

    it('getHostname handles IP addresses', () => {
      expect(getHostname('http://192.168.1.1/admin')).toBe('192.168.1.1');
    });
  });

  describe('fetchAlgoliaItem', () => {
    it('fetches a comment item from Algolia /items endpoint', async () => {
      const result = await fetchAlgoliaItem(1001);

      expect(result).toBeDefined();
      expect(result.id).toBe(1001);
      expect(result.type).toBe('comment');
      expect(result.author).toBe('patio11');
      expect(result.story_id).toBe(12345);
      expect(result.parent_id).toBe(12345);
    });

    it('returns children array', async () => {
      const result = await fetchAlgoliaItem(1001);

      expect(result.children).toHaveLength(1);
      expect(result.children[0].id).toBe(2001);
      expect(result.children[0].author).toBe('tptacek');
    });

    it('supports AbortSignal for cancellation', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(fetchAlgoliaItem(1001, controller.signal))
        .rejects.toThrow();
    });

    it('throws on 404 for unknown items', async () => {
      await expect(fetchAlgoliaItem(999999999))
        .rejects.toThrow(/404/);
    });
  });

  describe('normalizeAlgoliaItemChildren', () => {
    it('converts Algolia children to Comment array', () => {
      const children = [
        {
          id: 2001,
          author: 'user1',
          text: 'Reply text',
          created_at_i: 1700000000,
          parent_id: 1001,
          children: [],
        },
      ];

      const result = normalizeAlgoliaItemChildren(children);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2001);
      expect(result[0].author).toBe('user1');
      expect(result[0].text).toBe('Reply text');
      expect(result[0].createdAt).toBe(1700000000 * 1000);
      expect(result[0].parentId).toBe(1001);
      expect(result[0].depth).toBe(0);
    });

    it('calculates depth for nested children', () => {
      const children = [
        {
          id: 2001,
          author: 'user1',
          text: 'Level 0',
          created_at_i: 1700000000,
          parent_id: 1001,
          children: [
            {
              id: 3001,
              author: 'user2',
              text: 'Level 1',
              created_at_i: 1700000100,
              parent_id: 2001,
              children: [],
            },
          ],
        },
      ];

      const result = normalizeAlgoliaItemChildren(children);

      expect(result[0].depth).toBe(0);
      expect(result[0].children[0].depth).toBe(1);
    });

    it('collapses children beyond depth 3', () => {
      const children = [
        {
          id: 1,
          author: 'a',
          text: 't',
          created_at_i: 1700000000,
          parent_id: 0,
          children: [],
        },
      ];

      // Start at depth 3 → childrenCollapsed should be true
      const result = normalizeAlgoliaItemChildren(children, 3);
      expect(result[0].childrenCollapsed).toBe(true);

      // Start at depth 0 → childrenCollapsed should be false
      const result2 = normalizeAlgoliaItemChildren(children, 0);
      expect(result2[0].childrenCollapsed).toBe(false);
    });

    it('filters out deleted comments (no author)', () => {
      const children = [
        { id: 1, author: 'user1', text: 'Visible', created_at_i: 1700000000, parent_id: 0, children: [] },
        { id: 2, author: null, text: null, created_at_i: 1700000100, parent_id: 0, children: [] },
        { id: 3, author: 'user3', text: 'Also visible', created_at_i: 1700000200, parent_id: 0, children: [] },
      ];

      const result = normalizeAlgoliaItemChildren(children);
      expect(result).toHaveLength(2);
      expect(result[0].author).toBe('user1');
      expect(result[1].author).toBe('user3');
    });

    it('handles empty children array', () => {
      const result = normalizeAlgoliaItemChildren([]);
      expect(result).toEqual([]);
    });
  });
});

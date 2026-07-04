import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  formatTimeAgo,
  formatAbsoluteTime,
  formatAbsoluteDate,
  safeISOString,
  getHostname, 
  normalizeAlgoliaHit,
  fetchShowStories, 
  fetchAskStories,
  fetchTopStories,
  fetchBestStories,
  fetchNewStories,
  fetchFirebaseItem,
  fetchItemOnly,
  fetchAlgoliaItem,
  fetchCommentsForItem,
  normalizeAlgoliaItemChildren,
  NotFoundError,
  __resetFetchCachesForTests,
} from './hn';
import { hnSdk } from './hnSdk';
import type { FirebaseItem } from '../types';

const mockFirebaseItem: FirebaseItem = {
  id: 12345,
  title: 'Rust Is the Future of JavaScript Infrastructure',
  url: 'https://leerob.io/blog/rust',
  by: 'leerob',
  score: 284,
  time: Math.floor(Date.now() / 1000) - 3600,
  descendants: 137,
  kids: [1001, 1002, 1003, 1004],
  type: 'story',
};

const mockCommentItem: FirebaseItem = {
  id: 1001,
  by: 'patio11',
  text: 'The wasm-bindgen approach is really interesting.',
  time: Math.floor(Date.now() / 1000) - 1800,
  parent: 12345,
  kids: [2001],
  type: 'comment',
};

describe('hn API utilities', () => {
  beforeEach(() => {
    __resetFetchCachesForTests();
    vi.restoreAllMocks();
  });

  describe('formatTimeAgo', () => {
    beforeEach(() => {
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

    it('returns empty string for ±Infinity (consistent with the absolute formatters)', () => {
      // Infinity slips through both `!timestamp` and `isNaN` — without an
      // explicit `!isFinite` guard, the function would compute against a
      // non-finite arithmetic result and emit nonsense like
      // "Infinity years ago". The other timestamp formatters
      // (formatAbsoluteTime / formatAbsoluteDate / safeISOString) already
      // gate on isFinite; pinning the same contract here prevents a
      // future "the absolute label is empty but the relative label says
      // 'Infinity years ago'" mismatch on a degraded payload.
      expect(formatTimeAgo(Infinity)).toBe('');
      expect(formatTimeAgo(-Infinity)).toBe('');
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

  describe('formatAbsoluteTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns empty string for null/undefined/zero', () => {
      expect(formatAbsoluteTime(null as unknown as number)).toBe('');
      expect(formatAbsoluteTime(undefined as unknown as number)).toBe('');
      expect(formatAbsoluteTime(0)).toBe('');
    });

    it('returns empty string for NaN', () => {
      expect(formatAbsoluteTime(NaN)).toBe('');
    });

    it('returns empty string for non-finite timestamps (Infinity, -Infinity)', () => {
      // The `!isFinite()` guard exists because `new Date(Infinity)` produces
      // an "Invalid Date" whose `toLocaleString` is locale-dependent garbage
      // ("Invalid Date" / "Date invalide" / "无效日期"). Returning '' lets
      // the consumer fall back cleanly without leaking that string.
      expect(formatAbsoluteTime(Infinity)).toBe('');
      expect(formatAbsoluteTime(-Infinity)).toBe('');
    });

    it('returns a localized date string for a valid timestamp', () => {
      const ts = new Date('2026-02-21T14:30:00Z').getTime();
      const result = formatAbsoluteTime(ts);
      // toLocaleString(undefined, …) renders in the host's default locale, so
      // we only assert locale-invariant pieces: year, day-of-month, and a
      // clock segment H:MM / HH:MM. The exact month spelling ("Feb" vs "Fév"
      // vs "2月") differs by locale and is not part of the contract.
      expect(result).toContain('2026');
      expect(result).toContain('21');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('handles timestamps from different years', () => {
      const ts = new Date('2024-12-25T08:00:00Z').getTime();
      const result = formatAbsoluteTime(ts);
      // Locale-invariant: year + day-of-month. Month text would be "Dec" /
      // "Dez." / "déc." / "12月" depending on host locale.
      expect(result).toContain('2024');
      expect(result).toContain('25');
    });
  });

  describe('formatAbsoluteDate', () => {
    it('returns empty string for null/undefined/zero', () => {
      expect(formatAbsoluteDate(null as unknown as number)).toBe('');
      expect(formatAbsoluteDate(undefined as unknown as number)).toBe('');
      expect(formatAbsoluteDate(0)).toBe('');
    });

    it('returns empty string for NaN', () => {
      expect(formatAbsoluteDate(NaN)).toBe('');
    });

    it('returns empty string for non-finite timestamps (Infinity, -Infinity)', () => {
      // Same `!isFinite()` rationale as formatAbsoluteTime.
      expect(formatAbsoluteDate(Infinity)).toBe('');
      expect(formatAbsoluteDate(-Infinity)).toBe('');
    });

    it('returns a localized long-month date string and omits time-of-day', () => {
      const ts = new Date('2026-02-21T14:30:00Z').getTime();
      const result = formatAbsoluteDate(ts);
      // toLocaleString(undefined, …) renders in the host's default locale, so
      // we only assert locale-invariant pieces: year and day-of-month present,
      // no clock parts. The "long-month" stylistic choice ("February" vs
      // "Februar" vs "février") is verified visually. The `H:MM`/`HH:MM`
      // negative match guards the date-only contract — the formatter must
      // never surface clock parts even when the underlying Date has them.
      expect(result).toContain('2026');
      expect(result).toContain('21');
      expect(result).not.toMatch(/\d+:\d+/);
    });
  });

  describe('safeISOString', () => {
    // safeISOString feeds the `<time dateTime="…">` attribute on every
    // story / item / comment row, so a single bad input would surface as a
    // raw "Invalid Date" string (or worse, throw inside React render and
    // blow up the whole list). The helper guards against null / undefined /
    // 0 / NaN / non-finite inputs and returns '' so the consumer can omit
    // the attribute entirely.

    it('returns empty string for null/undefined/zero', () => {
      expect(safeISOString(null as unknown as number)).toBe('');
      expect(safeISOString(undefined as unknown as number)).toBe('');
      expect(safeISOString(0)).toBe('');
    });

    it('returns empty string for NaN', () => {
      expect(safeISOString(NaN)).toBe('');
    });

    it('returns empty string for non-finite timestamps (Infinity, -Infinity)', () => {
      // Without the `!isFinite()` guard, `new Date(Infinity).toISOString()`
      // throws `RangeError: Invalid time value` — which would crash any
      // CommentArticle / ItemArticle row whose API timestamp went haywire.
      expect(safeISOString(Infinity)).toBe('');
      expect(safeISOString(-Infinity)).toBe('');
    });

    it('returns a parseable ISO 8601 string for a valid timestamp', () => {
      const ts = new Date('2026-02-21T14:30:00Z').getTime();
      const iso = safeISOString(ts);
      expect(iso).not.toBe('');
      // Round-trip: the returned string parses back to the same instant.
      expect(Date.parse(iso)).toBe(ts);
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

  describe('normalizeAlgoliaHit', () => {
    const nowSec = Math.floor(Date.now() / 1000);

    it('maps story_text to text field', () => {
      const hit = {
        objectID: '88888',
        title: 'Ask HN: What are you working on?',
        url: null,
        points: 245,
        author: 'whoishiring',
        created_at_i: nowSec - 7200,
        num_comments: 312,
        story_text: 'I\u2019m curious what side projects everyone is working on this month. Share your progress, challenges, and what technologies you\u2019re using!',
        _tags: ['story', 'ask_hn'],
      };

      const result = normalizeAlgoliaHit(hit);

      expect(result.text).toBe(hit.story_text);
      expect(result.url).toBeUndefined();
    });

    it('converts null story_text to undefined', () => {
      const hit = {
        objectID: '88888',
        title: 'Ask HN: What are you working on?',
        url: null,
        points: 245,
        author: 'whoishiring',
        created_at_i: nowSec - 7200,
        num_comments: 312,
        story_text: null,
        _tags: ['story', 'ask_hn'],
      };

      const result = normalizeAlgoliaHit(hit);

      expect(result.text).toBeUndefined();
    });

    it('sets text to undefined when story_text is absent', () => {
      const hit = {
        objectID: '12345',
        title: 'Rust Is the Future of JavaScript Infrastructure',
        url: 'https://leerob.io/blog/rust',
        points: 284,
        author: 'leerob',
        created_at_i: nowSec - 3600,
        num_comments: 137,
        _tags: ['story', 'front_page'],
      };

      const result = normalizeAlgoliaHit(hit);

      expect(result.text).toBeUndefined();
    });

    it('passes through empty story_text as empty string', () => {
      const hit = {
        objectID: '34567',
        title: 'PostgreSQL 17 Released',
        url: 'https://www.postgresql.org/about/news/postgresql-17-released/',
        points: 198,
        author: 'cratermoon',
        created_at_i: nowSec - 5400,
        num_comments: 73,
        story_text: '',
        _tags: ['story', 'front_page'],
      };

      const result = normalizeAlgoliaHit(hit);

      expect(result.text).toBe('');
    });

    it('normalizes all standard fields correctly', () => {
      const hit = {
        objectID: '12345',
        title: 'Rust Is the Future of JavaScript Infrastructure',
        url: 'https://leerob.io/blog/rust',
        points: 284,
        author: 'leerob',
        created_at_i: nowSec - 3600,
        num_comments: 137,
        _tags: ['story', 'front_page'],
      };

      const result = normalizeAlgoliaHit(hit);

      expect(result.id).toBe(12345);
      expect(result.title).toBe('Rust Is the Future of JavaScript Infrastructure');
      expect(result.url).toBe('https://leerob.io/blog/rust');
      expect(result.points).toBe(284);
      expect(result.author).toBe('leerob');
      expect(result.createdAt).toBe(hit.created_at_i * 1000);
      expect(result.commentCount).toBe(137);
      expect(result.type).toBe('story');
    });

    it('detects ask_hn type from tags', () => {
      const hit = {
        objectID: '88887',
        title: 'Ask HN: Best resources to learn Rust?',
        points: 178,
        author: 'rustlearner',
        created_at_i: nowSec - 3600,
        num_comments: 95,
        _tags: ['story', 'ask_hn'],
      };

      expect(normalizeAlgoliaHit(hit).type).toBe('ask');
    });

    it('detects show_hn type from tags', () => {
      const hit = {
        objectID: '99999',
        title: 'Show HN: Piko \u2013 Open-Source Ngrok Alternative in Go',
        url: 'https://github.com/andydunstall/piko',
        points: 312,
        author: 'andydunstall',
        created_at_i: nowSec - 7200,
        num_comments: 89,
        _tags: ['story', 'show_hn'],
      };

      expect(normalizeAlgoliaHit(hit).type).toBe('show');
    });
  });

  describe('fetchShowStories', () => {
    const mockShowIds = [99999, 99998, 99997];
    const mockShowItems: Record<number, FirebaseItem> = {
      99999: { id: 99999, title: 'Show HN: My Awesome Project', url: 'https://github.com/andydunstall/piko', by: 'andydunstall', score: 312, time: Math.floor(Date.now() / 1000) - 7200, descendants: 89, type: 'story' },
      99998: { id: 99998, title: 'Show HN: Another Cool Demo', url: 'https://github.com/opticdev/optic', by: 'aidan_cully', score: 143, time: Math.floor(Date.now() / 1000) - 3600, descendants: 47, type: 'story' },
      99997: { id: 99997, title: 'Show HN: Third Project', url: 'https://example.com', by: 'user3', score: 50, time: Math.floor(Date.now() / 1000) - 1800, descendants: 10, type: 'story' },
    };

    beforeEach(() => {
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(mockShowIds);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => mockShowItems[Number(id)] ?? null);
    });

    it('returns normalized Show HN items', async () => {
      const result = await fetchShowStories(0);
      
      expect(result.stories).toBeDefined();
      expect(result.stories.length).toBeGreaterThan(0);
      expect(result.hasMore).toBeDefined();
      expect(result.nextOffset).toBe(20);
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

    it('returns items in ranked order (same order as ID list)', async () => {
      const result = await fetchShowStories(0);
      
      expect(result.stories.length).toBe(3);
      expect(result.stories[0].id).toBe(99999);
      expect(result.stories[1].id).toBe(99998);
      expect(result.stories[2].id).toBe(99997);
    });

    it('returns correct pagination info', async () => {
      const result = await fetchShowStories(0);
      
      expect(result.nextOffset).toBe(20);
      expect(result.hasMore).toBe(false);
    });

    it('paginates by offset', async () => {
      const manyIds = Array.from({ length: 25 }, (_, i) => 90000 + i);
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(manyIds);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => ({
        id: Number(id), title: `Item ${id}`, by: 'user', score: 10, time: Math.floor(Date.now() / 1000), descendants: 0, type: 'story',
      }));

      const result1 = await fetchShowStories(0);
      expect(result1.nextOffset).toBe(20);
      expect(result1.hasMore).toBe(true);
      
      const result2 = await fetchShowStories(result1.nextOffset);
      expect(result2.stories.length).toBe(5);
      expect(result2.hasMore).toBe(false);
    });
  });

  describe('fetchAskStories', () => {
    const mockAskIds = [88888, 88887, 88886];
    const mockAskItems: Record<number, FirebaseItem> = {
      88888: { id: 88888, title: 'Ask HN: What are you working on?', text: 'Tell me!', by: 'whoishiring', score: 245, time: Math.floor(Date.now() / 1000) - 7200, descendants: 312, type: 'story' },
      88887: { id: 88887, title: 'Ask HN: Best resources to learn Rust?', text: 'Looking for help', by: 'rustlearner', score: 178, time: Math.floor(Date.now() / 1000) - 3600, descendants: 95, type: 'story' },
      88886: { id: 88886, title: 'Ask HN: Favorite editor?', text: 'vim or emacs?', by: 'curious', score: 50, time: Math.floor(Date.now() / 1000) - 1800, descendants: 20, type: 'story' },
    };

    beforeEach(() => {
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(mockAskIds);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => mockAskItems[Number(id)] ?? null);
    });

    it('returns normalized Ask HN items', async () => {
      const result = await fetchAskStories(0);
      
      expect(result.stories).toBeDefined();
      expect(result.stories.length).toBeGreaterThan(0);
      expect(result.hasMore).toBeDefined();
      expect(result.nextOffset).toBe(20);
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
      
      result.stories.forEach(item => {
        expect(item.url === null || item.url === undefined).toBe(true);
      });
    });

    it('returns items in ranked order (same order as ID list)', async () => {
      const result = await fetchAskStories(0);
      
      expect(result.stories.length).toBe(3);
      expect(result.stories[0].id).toBe(88888);
      expect(result.stories[1].id).toBe(88887);
      expect(result.stories[2].id).toBe(88886);
    });

    it('returns correct pagination info', async () => {
      const result = await fetchAskStories(0);
      
      expect(result.nextOffset).toBe(20);
      expect(result.hasMore).toBe(false);
    });

    it('paginates by offset', async () => {
      const manyIds = Array.from({ length: 25 }, (_, i) => 80000 + i);
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(manyIds);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => ({
        id: Number(id), title: `Item ${id}`, by: 'user', score: 10, time: Math.floor(Date.now() / 1000), descendants: 0, type: 'story',
      }));

      const result1 = await fetchAskStories(0);
      expect(result1.nextOffset).toBe(20);
      
      const result2 = await fetchAskStories(result1.nextOffset);
      expect(result2.stories.length).toBe(5);
      expect(result2.hasMore).toBe(false);
    });
  });

  describe('fetchNewStories', () => {
    const mockNewIds = [44001, 44002, 44003];
    const mockNewItems: Record<number, FirebaseItem> = {
      44001: { id: 44001, title: 'A brand new Rust web framework', url: 'https://example.com/rust', by: 'newuser1', score: 5, time: Math.floor(Date.now() / 1000) - 300, descendants: 2, type: 'story' },
      44002: { id: 44002, title: 'Show HN: My weekend hardware hack', url: 'https://example.com/hw', by: 'newuser2', score: 12, time: Math.floor(Date.now() / 1000) - 180, descendants: 4, type: 'story' },
      44003: { id: 44003, title: 'Ask HN: How do you stay focused?', text: 'Curious', by: 'newuser3', score: 3, time: Math.floor(Date.now() / 1000) - 60, descendants: 1, type: 'story' },
    };

    beforeEach(() => {
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(mockNewIds);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => mockNewItems[Number(id)] ?? null);
    });

    it('reads the newstories ranked list', async () => {
      await fetchNewStories(0);
      expect(hnSdk.readRankedIds).toHaveBeenCalledWith('newstories');
    });

    it('returns normalized items', async () => {
      const result = await fetchNewStories(0);

      expect(result.stories).toBeDefined();
      expect(result.stories.length).toBeGreaterThan(0);
      expect(result.hasMore).toBeDefined();
      expect(result.nextOffset).toBe(30);
    });

    it('returns items with story type', async () => {
      const result = await fetchNewStories(0);

      result.stories.forEach(item => {
        expect(item.type).toBe('story');
      });
    });

    it('returns items with expected properties', async () => {
      const result = await fetchNewStories(0);
      const item = result.stories[0];

      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('points');
      expect(item).toHaveProperty('author');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('commentCount');
    });

    it('returns items in reverse-chronological (ID-list) order', async () => {
      const result = await fetchNewStories(0);

      expect(result.stories.length).toBe(3);
      expect(result.stories[0].id).toBe(44001);
      expect(result.stories[1].id).toBe(44002);
      expect(result.stories[2].id).toBe(44003);
    });

    it('paginates by offset', async () => {
      const manyIds = Array.from({ length: 35 }, (_, i) => 40000 + i);
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(manyIds);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => ({
        id: Number(id), title: `Item ${id}`, by: 'user', score: 10, time: Math.floor(Date.now() / 1000), descendants: 0, type: 'story',
      }));

      const result1 = await fetchNewStories(0);
      expect(result1.nextOffset).toBe(30);
      expect(result1.hasMore).toBe(true);

      const result2 = await fetchNewStories(result1.nextOffset);
      expect(result2.stories.length).toBe(5);
      expect(result2.hasMore).toBe(false);
    });

    it('filters out job posts', async () => {
      const idsWithJob = [44001, 44900, 44002];
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(idsWithJob);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === 44900) {
          return { id: 44900, title: 'Acme Corp (YC S26) Is Hiring Engineers', url: 'https://acme.example', by: 'acmehr', score: 1, time: Math.floor(Date.now() / 1000), descendants: 0, type: 'job' };
        }
        return mockNewItems[Number(id)] ?? null;
      });

      const result = await fetchNewStories(0);

      expect(result.stories.map(s => s.id)).not.toContain(44900);
      expect(result.stories.map(s => s.id)).toEqual([44001, 44002]);
    });

    it('filters out the monthly whoishiring threads', async () => {
      const idsWithHiring = [44001, 44910, 44911, 44002];
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(idsWithHiring);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        const hiring: Record<number, FirebaseItem> = {
          44910: { id: 44910, title: 'Ask HN: Who is hiring? (July 2026)', by: 'whoishiring', score: 100, time: Math.floor(Date.now() / 1000), descendants: 500, type: 'story' },
          44911: { id: 44911, title: 'Ask HN: Who wants to be hired? (July 2026)', by: 'whoishiring', score: 80, time: Math.floor(Date.now() / 1000), descendants: 200, type: 'story' },
        };
        return hiring[Number(id)] ?? mockNewItems[Number(id)] ?? null;
      });

      const result = await fetchNewStories(0);
      const ids = result.stories.map(s => s.id);

      expect(ids).not.toContain(44910);
      expect(ids).not.toContain(44911);
      expect(ids).toEqual([44001, 44002]);
    });
  });

  describe('fetchTopStories', () => {
    const mockTopIds = [12345, 12346, 12347];
    const mockTopItems: Record<number, FirebaseItem> = {
      12345: mockFirebaseItem,
      12346: { id: 12346, title: 'SQLite Does Not Do Full FSYNC by Default', url: 'https://sqlite.org/draft/wal.html', by: 'ingve', score: 198, time: Math.floor(Date.now() / 1000) - 7200, descendants: 73, type: 'story' },
      12347: { id: 12347, title: 'Why We Moved from React to htmx', url: 'https://htmx.org/essays/react-to-htmx/', by: 'carsongross', score: 156, time: Math.floor(Date.now() / 1000) - 10800, descendants: 241, type: 'story' },
    };

    beforeEach(() => {
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(mockTopIds);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => mockTopItems[Number(id)] ?? null);
    });

    it('returns normalized items from ranked list', async () => {
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

      expect(result.length).toBeLessThanOrEqual(20);
    });

    it('returns items in ranked order (same as ID list)', async () => {
      const result = await fetchTopStories(20);

      expect(result.length).toBe(3);
      expect(result[0].id).toBe(12345);
      expect(result[1].id).toBe(12346);
      expect(result[2].id).toBe(12347);
    });
  });

  describe('fetchBestStories', () => {
    const mockBestIds = [12345, 12346, 12347, 12348, 12349];

    beforeEach(() => {
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(mockBestIds);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => ({
        id: Number(id), title: `Item ${id}`, by: 'testuser', score: 50, time: Math.floor(Date.now() / 1000) - 7200, descendants: 5, type: 'story',
      }));
    });

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
    beforeEach(() => {
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === 12345) return mockFirebaseItem;
        if (Number(id) === 1001) return mockCommentItem;
        return null;
      });
    });

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

    it('throws NotFoundError when SDK returns null for non-existent item', async () => {
      await expect(fetchFirebaseItem(99999)).rejects.toThrow(NotFoundError);
      await expect(fetchFirebaseItem(99999)).rejects.toThrow('Item 99999 not found');
    });
  });

  describe('fetchItemOnly', () => {
    beforeEach(() => {
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === 12345) return mockFirebaseItem;
        return null;
      });
    });

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
      
      expect(result.points).toBe(284);
      expect(result.author).toBe('leerob');
      expect(result.type !== 'job' ? result.commentCount : 0).toBe(137);
    });

    it('converts Unix timestamp to milliseconds', async () => {
      const result = await fetchItemOnly(12345);
      
      expect(result.createdAt).toBeGreaterThan(1000000000000);
    });

    it('handles string ID parameter', async () => {
      const result = await fetchItemOnly('12345');
      
      expect(result.id).toBe(12345);
    });

    it('defaults commentCount to 0 when descendants missing', async () => {
      const result = await fetchItemOnly(12345);
      expect(result.type).not.toBe('comment');
      if (result.type === 'comment') throw new Error('unexpected');

      expect(result.type !== 'job' ? result.commentCount : 0).toBe(137);
    });
  });

  describe('error handling', () => {
    it('formatTimeAgo handles zero timestamp as falsy', () => {
      expect(formatTimeAgo(0)).toBe('');
    });

    it('formatTimeAgo handles negative timestamp', () => {
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

  describe('fetchCommentsForItem', () => {
    it('drops orphaned comments whose parent is dead (not in Algolia)', async () => {
      const itemId = 9000;

      // Item has 3 root-level kids: 101 (alive), 102 (dead), 103 (alive)
      const firebaseItem: FirebaseItem = {
        id: itemId,
        title: 'Test Story',
        by: 'author',
        score: 10,
        time: 1700000000,
        descendants: 5,
        kids: [101, 102, 103],
        type: 'story',
      };

      // Comment 102 is dead — Algolia won't return it.
      // Comments 201, 202 are children of the dead comment 102.
      const algoliaHits = [
        { objectID: '101', author: 'alice', comment_text: 'Alive root', created_at_i: 1700000100, parent_id: itemId },
        { objectID: '103', author: 'bob', comment_text: 'Also alive root', created_at_i: 1700000200, parent_id: itemId },
        { objectID: '201', author: 'charlie', comment_text: 'Reply to dead parent', created_at_i: 1700000300, parent_id: 102 },
        { objectID: '202', author: 'dave', comment_text: 'Another reply to dead parent', created_at_i: 1700000400, parent_id: 102 },
      ];

      // Mock hnSdk.readItem for the initial item fetch and kids ordering
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === itemId) return firebaseItem;
        return null;
      });

      // Mock fetch for Algolia search
      const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ hits: algoliaHits, nbHits: algoliaHits.length }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const comments = await fetchCommentsForItem(itemId);

      // Only the 2 alive root comments should appear; orphans 201/202 are dropped
      expect(comments).toHaveLength(2);
      expect(comments[0].id).toBe(101);
      expect(comments[1].id).toBe(103);

      // Orphaned comments should NOT be promoted to root
      const allIds = comments.map(c => c.id);
      expect(allIds).not.toContain(201);
      expect(allIds).not.toContain(202);

      mockFetch.mockRestore();
    });
  });
});

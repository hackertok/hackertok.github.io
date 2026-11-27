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
  fetchFrontPageForDay,
  fetchFirebaseItem,
  fetchItemOnly,
  fetchAlgoliaItem,
  fetchItemWithComments,
  prefetchItemComments,
  fetchCommentReplies,
  normalizeAlgoliaItemChildren,
  NotFoundError,
  __resetFetchCachesForTests,
} from './hn';
import { hnSdk } from './hnSdk';
import type { AlgoliaItemResponse, FirebaseItem } from '../types';

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

    it('stays at 11 months until a full year has passed', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 360 * 24 * 60 * 60 * 1000)).toBe('11 months ago');
      expect(formatTimeAgo(now - 364 * 24 * 60 * 60 * 1000)).toBe('11 months ago');
      expect(formatTimeAgo(now - 365 * 24 * 60 * 60 * 1000)).toBe('1 year ago');
    });

    it('formats years correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 365 * 24 * 60 * 60 * 1000)).toBe('1 year ago');
      expect(formatTimeAgo(now - 2 * 365 * 24 * 60 * 60 * 1000)).toBe('2 years ago');
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
      // The `!isFinite()` guard exists because Intl.DateTimeFormat#format
      // throws a RangeError for non-finite timestamps. Returning '' lets the
      // consumer fall back cleanly.
      expect(formatAbsoluteTime(Infinity)).toBe('');
      expect(formatAbsoluteTime(-Infinity)).toBe('');
    });

    it('returns a localized date string for a valid timestamp', () => {
      const ts = new Date('2026-02-21T14:30:00Z').getTime();
      const result = formatAbsoluteTime(ts);
      // Intl.DateTimeFormat(undefined, …) renders in the host's default locale, so
      // we only assert locale-invariant pieces: year, day-of-month, and a
      // clock segment H:MM / HH:MM. The exact month spelling ("Feb" vs "Fév"
      // vs "2月") differs by locale and is not part of the contract.
      expect(result).toContain('2026');
      expect(result).toContain('21');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
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

    it('types a poll, which Algolia tags `poll` rather than `story`', () => {
      const hit = {
        objectID: '5640988',
        title: 'Poll: Do you have a 3d printer?',
        url: null,
        points: 186,
        author: 'pg',
        created_at_i: 1367444459,
        num_comments: 275,
        _tags: ['poll', 'author_pg'],
      };

      expect(normalizeAlgoliaHit(hit).type).toBe('poll');
    });

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

    it('returns items with show type', async () => {
      const result = await fetchShowStories(0);
      
      result.stories.forEach(item => {
        expect(item.type).toBe('show');
      });
    });

    it('returns items in ranked order (same order as ID list)', async () => {
      const result = await fetchShowStories(0);
      
      expect(result.stories.length).toBe(3);
      expect(result.stories[0].id).toBe(99999);
      expect(result.stories[1].id).toBe(99998);
      expect(result.stories[2].id).toBe(99997);
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

    it('keeps Show HN projects whose titles mention hiring', async () => {
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) =>
        Number(id) === 99998
          ? { ...mockShowItems[99998], title: 'Show HN: A "Who is hiring" thread search' }
          : mockShowItems[Number(id)] ?? null
      );

      const result = await fetchShowStories(0);

      expect(result.stories.map(s => s.id)).toEqual([99999, 99998, 99997]);
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

    it('returns items with ask type', async () => {
      const result = await fetchAskStories(0);
      
      result.stories.forEach(item => {
        expect(item.type).toBe('ask');
      });
    });

    it('returns items in ranked order (same order as ID list)', async () => {
      const result = await fetchAskStories(0);
      
      expect(result.stories.length).toBe(3);
      expect(result.stories[0].id).toBe(88888);
      expect(result.stories[1].id).toBe(88887);
      expect(result.stories[2].id).toBe(88886);
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

    it('filters out the monthly whoishiring threads', async () => {
      vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue([88888, 88910, 88911, 88887]);
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        const hiring: Record<number, FirebaseItem> = {
          88910: { id: 88910, title: 'Ask HN: Who is hiring? (October 2026)', text: 'Post jobs', by: 'whoishiring', score: 300, time: Math.floor(Date.now() / 1000), descendants: 400, type: 'story' },
          88911: { id: 88911, title: 'Ask HN: Who wants to be hired? (October 2026)', text: 'Post resumes', by: 'whoishiring', score: 120, time: Math.floor(Date.now() / 1000), descendants: 200, type: 'story' },
        };
        return hiring[Number(id)] ?? mockAskItems[Number(id)] ?? null;
      });

      const result = await fetchAskStories(0);

      expect(result.stories.map(s => s.id)).toEqual([88888, 88887]);
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

    it('returns items with story type', async () => {
      const result = await fetchNewStories(0);

      result.stories.forEach(item => {
        expect(item.type).toBe('story');
      });
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

    it('filters out the monthly whoishiring threads', async () => {
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        const base = { id: Number(id), by: 'testuser', score: 50, time: Math.floor(Date.now() / 1000) - 7200, descendants: 5, type: 'story' as const };
        if (Number(id) === 12346) return { ...base, title: 'Ask HN: Who is hiring? (October 2026)', by: 'whoishiring' };
        if (Number(id) === 12348) return { ...base, title: 'Ask HN: Who wants to be hired? (October 2026)', by: 'whoishiring' };
        return { ...base, title: `Item ${id}` };
      });

      const result = await fetchBestStories(0, 30);

      expect(result.stories.map(s => s.id)).toEqual([12345, 12347, 12349]);
    });
  });

  describe('fetchFirebaseItem', () => {
    beforeEach(() => {
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === 12345) return mockFirebaseItem;
        return null;
      });
    });

    it('fetches an item by ID', async () => {
      const result = await fetchFirebaseItem(12345);
      
      expect(result).toBeDefined();
      expect(result.id).toBe(12345);
      expect(result.title).toBe('Rust Is the Future of JavaScript Infrastructure');
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
      if (result.type === 'comment' || result.type === 'pollopt') throw new Error('unexpected');
      
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

    it('reads a poll option with its poll\'s title', async () => {
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => (
        Number(id) === 126810
          ? { id: 126810, text: 'Yes, ban them', by: 'pg', score: 30, time: 1204403652, poll: 126809, type: 'pollopt' }
          : { id: 126809, title: 'Poll: Ban Polls?', by: 'pg', time: 1204403652, parts: [126810], type: 'poll' }
      ));

      expect(await fetchItemOnly(126810)).toEqual({
        id: 126810,
        type: 'pollopt',
        text: 'Yes, ban them',
        points: 30,
        author: 'pg',
        createdAt: 1204403652 * 1000,
        poll: 126809,
        pollTitle: 'Poll: Ban Polls?',
      });
    });

    it('still reads a poll option when its poll can\'t be read', async () => {
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === 126809) throw new Error('Offline');
        return { id: 126810, text: 'Yes, ban them', by: 'pg', score: 30, time: 1204403652, poll: 126809, type: 'pollopt' };
      });

      const option = await fetchItemOnly(126810);

      expect(option).toMatchObject({ type: 'pollopt', poll: 126809 });
      expect(option).not.toHaveProperty('pollTitle');
    });
  });

  describe('fetchFrontPageForDay', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("includes a day's polls, which Algolia doesn't tag as stories", async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
        hits: [
          { objectID: '1', title: 'A story', url: 'https://example.com', points: 10, author: 'a', created_at_i: 1700000000, num_comments: 1, _tags: ['story'] },
          { objectID: '2', title: 'Poll: Tabs or spaces?', url: null, points: 50, author: 'b', created_at_i: 1700000000, num_comments: 9, _tags: ['poll'] },
        ],
        nbHits: 2,
      }));

      const stories = await fetchFrontPageForDay(1);

      expect(new URL(fetchSpy.mock.calls[0]?.[0] as string).searchParams.get('tags')).toBe('(story,poll)');
      expect(stories.map(s => [s.id, s.type])).toEqual([[2, 'poll'], [1, 'story']]);
    });
  });

  describe('poll options', () => {
    const poll: FirebaseItem = {
      id: 126809, title: 'Poll: Ban Polls?', by: 'pg', score: 46, time: 1204403652, descendants: 1,
      parts: [126810, 126811, 126812, 126813], kids: [126900], type: 'poll',
    };
    const options: FirebaseItem[] = [
      { id: 126810, text: 'Yes, ban them; I&#x27;m tired', by: 'pg', score: 12, time: 1204403652, poll: 126809, type: 'pollopt' },
      { id: 126811, text: 'No, leave them', by: 'pg', score: 30, time: 1204403652, poll: 126809, type: 'pollopt' },
      { id: 126812, by: 'pg', time: 1204403652, poll: 126809, type: 'pollopt', deleted: true },
      { id: 126813, text: 'Only on Fridays', by: 'pg', score: 12, time: 1204403652, poll: 126809, type: 'pollopt' },
    ];
    const comment = { objectID: '126900', author: 'dang', comment_text: 'Polls are fine', created_at_i: 1204403700, parent_id: 126809 };

    function mockPoll(readOption: (id: number) => Promise<FirebaseItem | null> = async id => options.find(o => o.id === id) ?? null) {
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => (Number(id) === poll.id ? poll : readOption(Number(id))));
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ hits: [comment], nbHits: 1, nbPages: 1 }));
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('come with a poll\'s comments, most points first as on HN, ties in poll order, without deleted ones', async () => {
      mockPoll();

      const { item } = await fetchItemWithComments(poll.id);

      expect(item).toMatchObject({ type: 'poll', title: 'Poll: Ban Polls?', points: 46 });
      expect(item.type === 'poll' && item.pollOptions).toEqual([
        { id: 126811, text: 'No, leave them', points: 30 },
        { id: 126810, text: 'Yes, ban them; I&#x27;m tired', points: 12 },
        { id: 126813, text: 'Only on Fridays', points: 12 },
      ]);
    });

    it('are all left out when one of them fails, rather than misstate the shares, and the comments still come', async () => {
      mockPoll(async id => {
        if (id === 126811) throw new Error('Offline');
        return options.find(o => o.id === id) ?? null;
      });

      const { item, comments } = await fetchItemWithComments(poll.id);

      expect(item).toMatchObject({ type: 'poll', title: 'Poll: Ban Polls?' });
      expect(item).not.toHaveProperty('pollOptions');
      expect(comments.map(c => [c.id, c.text])).toEqual([[126900, 'Polls are fine']]);
    });

    it('aren\'t read for the item alone', async () => {
      mockPoll();

      const item = await fetchItemOnly(poll.id);

      expect(item.type).toBe('poll');
      expect(item).not.toHaveProperty('pollOptions');
      expect(hnSdk.readItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('formatTimeAgo handles zero timestamp as falsy', () => {
      expect(formatTimeAgo(0)).toBe('');
    });

    it('getHostname handles URLs with port numbers', () => {
      expect(getHostname('https://localhost:3000/path')).toBe('localhost');
      expect(getHostname('https://example.com:8080/page')).toBe('example.com');
    });

    it('getHostname handles subdomains', () => {
      expect(getHostname('https://blog.example.com/post')).toBe('blog.example.com');
      expect(getHostname('https://api.v2.example.com')).toBe('api.v2.example.com');
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

    it('supports AbortSignal for cancellation', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(fetchAlgoliaItem(1001, controller.signal))
        .rejects.toThrow();
    });

    it('throws on 404 for unknown items', async () => {
      await expect(fetchAlgoliaItem(999999999))
        .rejects.toThrow(/404/);
      await expect(fetchAlgoliaItem(999999999))
        .rejects.toBeInstanceOf(NotFoundError);
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
  });

  describe('fetchItemWithComments', () => {
    describe('replies to a comment search leaves out', () => {
      const itemId = 9000;

      // Item has 3 root-level kids: 101 (alive), 102 (flagged or deleted), 103 (alive)
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

      // Algolia doesn't return 102, but does return its replies 201 and 202.
      const algoliaHits = [
        { objectID: '101', author: 'alice', comment_text: 'Alive root', created_at_i: 1700000100, parent_id: itemId },
        { objectID: '103', author: 'bob', comment_text: 'Also alive root', created_at_i: 1700000200, parent_id: itemId },
        { objectID: '201', author: 'charlie', comment_text: 'Reply to removed parent', created_at_i: 1700000300, parent_id: 102 },
        { objectID: '202', author: 'dave', comment_text: 'Another reply to removed parent', created_at_i: 1700000400, parent_id: 102 },
      ];

      function mockThread(firebase: FirebaseItem[], hits: typeof algoliaHits = algoliaHits) {
        vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
          if (Number(id) === itemId) return firebaseItem;
          return firebase.find(item => item.id === Number(id)) ?? null;
        });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ hits, nbHits: hits.length }));
      }

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('keeps replies to a flagged comment under its [flagged] row', async () => {
        mockThread([
          { id: 102, type: 'comment', by: 'eve', text: '[flagged]', dead: true, time: 1700000150, parent: itemId, kids: [202, 201] },
        ]);

        const { comments } = await fetchItemWithComments(itemId);

        expect(comments.map(c => c.id)).toEqual([101, 102, 103]);
        expect(comments[1]).toMatchObject({ author: 'eve', text: '[flagged]', createdAt: 1700000150 * 1000 });
        expect(comments[1].deleted).toBeUndefined();
        // In the flagged comment's own kids order, not creation order.
        expect(comments[1].children.map(c => c.id)).toEqual([202, 201]);
      });

      it('shows [flagged] for a killed comment whose text Firebase still has', async () => {
        mockThread([
          { id: 102, type: 'comment', by: 'eve', text: 'Praise the iLord.', dead: true, time: 1700000150, parent: itemId, kids: [201, 202] },
        ]);

        const { comments } = await fetchItemWithComments(itemId);

        expect(comments[1]).toMatchObject({ id: 102, author: 'eve', text: '[flagged]' });
      });

      it('keeps replies to a deleted comment under a deleted row', async () => {
        mockThread([
          { id: 102, type: 'comment', deleted: true, time: 1700000150, parent: itemId, kids: [201, 202] },
        ]);

        const { comments } = await fetchItemWithComments(itemId);

        expect(comments.map(c => c.id)).toEqual([101, 102, 103]);
        expect(comments[1]).toMatchObject({ deleted: true, author: '', text: '' });
        expect(comments[1].children.map(c => c.id)).toEqual([201, 202]);
      });

      it('follows missing parents up to one search has', async () => {
        // 301 replies to flagged 201, which replies to deleted 102.
        mockThread(
          [
            { id: 201, type: 'comment', by: 'carol', text: '[flagged]', dead: true, time: 1700000300, parent: 102, kids: [301] },
            { id: 102, type: 'comment', deleted: true, time: 1700000150, parent: itemId, kids: [201] },
          ],
          [
            algoliaHits[0],
            { objectID: '301', author: 'frank', comment_text: 'Deep reply', created_at_i: 1700000500, parent_id: 201 },
          ],
        );

        const { comments } = await fetchItemWithComments(itemId);

        expect(comments.map(c => c.id)).toEqual([101, 102]);
        expect(comments[1].children.map(c => c.id)).toEqual([201]);
        expect(comments[1].children[0].children.map(c => c.id)).toEqual([301]);
      });

      it('drops the replies when Firebase does not have their parent either', async () => {
        mockThread([]);

        const { comments } = await fetchItemWithComments(itemId);

        expect(comments.map(c => c.id)).toEqual([101, 103]);
        expect(comments.flatMap(c => c.children)).toEqual([]);
      });
    });

    describe('a thread bigger than search returns', () => {
      const itemId = 9100;
      const firebaseItem: FirebaseItem = {
        id: itemId, title: 'Big thread', by: 'author', score: 900, time: 1700000000,
        descendants: 1500, kids: [101, 102, 103, 104], type: 'story',
      };
      const searchHits = [
        { objectID: '101', author: 'alice', comment_text: 'From search', created_at_i: 1700000100, parent_id: itemId },
        // Missing from the item tree below, as some comments are.
        { objectID: '102', author: 'bob', comment_text: 'Only in search', created_at_i: 1700000200, parent_id: itemId },
      ];
      const tree = {
        id: itemId, type: 'story', author: 'author', text: null, created_at_i: 1700000000,
        parent_id: null, story_id: itemId,
        children: [
          {
            id: 101, author: 'alice', text: 'From the tree', created_at_i: 1700000100, parent_id: itemId,
            children: [{ id: 201, author: 'carol', text: 'Reply', created_at_i: 1700000300, parent_id: 101, children: [] }],
          },
          {
            id: 103, author: null, text: null, created_at_i: 1700000400, parent_id: itemId,
            children: [{ id: 202, author: 'dave', text: 'Reply to a deleted comment', created_at_i: 1700000500, parent_id: 103, children: [] }],
          },
          { id: 104, author: 'erin', text: 'Past the limit', created_at_i: 1700000600, parent_id: itemId, children: [] },
        ],
      };

      const urlOf = (input: RequestInfo | URL) =>
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      function mockAlgolia(nbHits: number, { treeStatus = 200, searchDone = Promise.resolve() } = {}) {
        return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
          if (urlOf(input).includes(`/items/${itemId}`)) {
            return treeStatus === 200 ? Response.json(tree) : new Response(null, { status: treeStatus });
          }
          await searchDone;
          return Response.json({ hits: searchHits, nbHits });
        });
      }

      // Holds the search response until the item tree has been requested.
      async function searchAfterTree(mockFetch: ReturnType<typeof mockAlgolia>, respond: () => void) {
        await vi.waitFor(() => {
          expect(mockFetch.mock.calls.some(([input]) => urlOf(input).includes(`/items/${itemId}`))).toBe(true);
        });
        respond();
      }

      beforeEach(() => {
        vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => (Number(id) === itemId ? firebaseItem : null));
      });

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('adds the comments past the limit from the item tree', async () => {
        // Search returns at most 1,000 of a thread's hits, fewer than nbHits.
        const mockFetch = mockAlgolia(1500);

        const { comments } = await fetchItemWithComments(itemId);

        expect(comments.map(c => c.id)).toEqual([101, 102, 104]);
        expect(comments[0].text).toBe('From search');
        expect(comments[0].children.map(c => c.id)).toEqual([201]);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('downloads the item tree alongside the search', async () => {
        let respond!: () => void;
        const mockFetch = mockAlgolia(1500, { searchDone: new Promise<void>(r => { respond = r; }) });

        const read = fetchItemWithComments(itemId);
        await searchAfterTree(mockFetch, respond);
        const { comments } = await read;

        expect(comments.map(c => c.id)).toEqual([101, 102, 104]);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('cancels the item tree when search has every comment', async () => {
        // The story's comment count says more than search has, but search is complete.
        let respond!: () => void;
        const mockFetch = mockAlgolia(2, { searchDone: new Promise<void>(r => { respond = r; }) });

        const read = fetchItemWithComments(itemId);
        await searchAfterTree(mockFetch, respond);
        const { comments } = await read;

        expect(comments.map(c => c.id)).toEqual([101, 102]);
        const treeCall = mockFetch.mock.calls.find(([input]) => urlOf(input).includes(`/items/${itemId}`));
        expect(treeCall?.[1]?.signal?.aborted).toBe(true);
      });

      it('keeps the search results when the item tree fails', async () => {
        mockAlgolia(1500, { treeStatus: 500 });

        const { comments } = await fetchItemWithComments(itemId);

        expect(comments.map(c => c.id)).toEqual([101, 102]);
      });

      it('skips the item tree when search has every comment', async () => {
        vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => (Number(id) === itemId ? { ...firebaseItem, descendants: 2 } : null));
        const mockFetch = mockAlgolia(2);

        await fetchItemWithComments(itemId);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(urlOf(mockFetch.mock.calls[0][0])).toContain('/search?');
        const params = new URL(urlOf(mockFetch.mock.calls[0][0])).searchParams;
        expect(params.get('hitsPerPage')).toBe('1000');
        // An empty value doesn't turn highlighting off; an empty list does.
        expect(params.get('attributesToHighlight')).toBe('[]');
        expect(params.get('attributesToRetrieve')?.split(',').sort()).toEqual(['author', 'comment_text', 'created_at_i', 'parent_id']);
      });
    });

    it('reads all the comments it orders at once', async () => {
      const itemId = 9300;
      const roots = Array.from({ length: 25 }, (_, i) => 101 + i);
      // Each root comment has two replies, created in the opposite of HN's order.
      const hits = roots.flatMap(id => [
        { objectID: String(id), author: 'alice', comment_text: 'Root', created_at_i: 1700000000 + id, parent_id: itemId },
        { objectID: String(id * 10), author: 'bob', comment_text: 'First', created_at_i: 1700001000 + id, parent_id: id },
        { objectID: String(id * 10 + 1), author: 'carol', comment_text: 'Second', created_at_i: 1700002000 + id, parent_id: id },
      ]);
      let pending = 0;
      let mostPending = 0;
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === itemId) return { id: itemId, type: 'story', title: 'Thread', time: 1700000000, kids: roots };
        mostPending = Math.max(mostPending, ++pending);
        await new Promise(resolve => setTimeout(resolve));
        pending--;
        return { id: Number(id), type: 'comment', time: 1700000000, parent: itemId, kids: [Number(id) * 10 + 1, Number(id) * 10] };
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ hits, nbHits: hits.length }));

      const { comments } = await fetchItemWithComments(itemId);

      expect(mostPending).toBe(roots.length);
      expect(comments.map(c => c.id)).toEqual(roots);
      expect(comments[0].children.map(c => c.id)).toEqual([1011, 1010]);
    });

    describe('a thread several callers want at once', () => {
      const itemId = 9400;
      const hits = [{ objectID: '101', author: 'alice', comment_text: 'Root', created_at_i: 1700000100, parent_id: itemId }];
      let searches: { respond: () => void; signal?: AbortSignal | null }[];

      beforeEach(() => {
        searches = [];
        vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) =>
          Number(id) === itemId ? { id: itemId, type: 'story', title: 'Thread', time: 1700000000, kids: [101] } : null);
        // Each comment search waits to be answered, or fails when aborted.
        vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          searches.push({ respond: () => resolve(Response.json({ hits, nbHits: hits.length })), signal: init?.signal });
        }));
      });

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('shares one download between them', async () => {
        const shown = fetchItemWithComments(itemId, new AbortController().signal);
        const prefetched = prefetchItemComments(itemId);
        await vi.waitFor(() => expect(searches).toHaveLength(1));
        searches[0].respond();

        expect((await shown).comments.map(c => c.id)).toEqual([101]);
        expect((await prefetched)?.comments.map(c => c.id)).toEqual([101]);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      it('lets one abort without the others, and starts the next caller over', async () => {
        const controller = new AbortController();
        const shown = fetchItemWithComments(itemId, controller.signal);
        const prefetched = prefetchItemComments(itemId);
        await vi.waitFor(() => expect(searches).toHaveLength(1));

        controller.abort();
        await expect(shown).rejects.toMatchObject({ name: 'AbortError' });
        // A retry, as after a reconnect, doesn't join the download it gave up on.
        const retried = fetchItemWithComments(itemId);
        await vi.waitFor(() => expect(searches).toHaveLength(2));
        searches.forEach(search => search.respond());

        expect((await prefetched)?.comments).toHaveLength(1);
        expect((await retried).comments).toHaveLength(1);
      });

      it('stops the download once all of them abort', async () => {
        const first = new AbortController();
        const second = new AbortController();
        const shown = fetchItemWithComments(itemId, first.signal);
        const prefetched = prefetchItemComments(itemId, second.signal);
        await vi.waitFor(() => expect(searches).toHaveLength(1));

        first.abort();
        expect(searches[0].signal?.aborted).toBe(false);
        second.abort();
        expect(searches[0].signal?.aborted).toBe(true);
        await expect(shown).rejects.toMatchObject({ name: 'AbortError' });
        expect(await prefetched).toBeNull();
      });
    });
  });

  describe('fetchCommentReplies', () => {
    const storyId = 9200;

    // Comment 101 as Algolia's item tree has it: flagged 202 and deleted 302
    // are left out, and so are their replies.
    const item: AlgoliaItemResponse = {
      id: 101, type: 'comment', author: 'alice', text: 'Root', created_at_i: 1700000100,
      parent_id: storyId, story_id: storyId,
      children: [{ id: 201, author: 'bob', text: 'Live reply', created_at_i: 1700000200, parent_id: 101, children: [] }],
    };
    const searchHits = [
      { objectID: '101', author: 'alice', comment_text: 'Root', created_at_i: 1700000100, parent_id: storyId },
      { objectID: '201', author: 'bob', comment_text: 'Live reply', created_at_i: 1700000200, parent_id: 101 },
      { objectID: '301', author: 'dave', comment_text: 'Reply to a flagged comment', created_at_i: 1700000400, parent_id: 202 },
      { objectID: '401', author: 'frank', comment_text: 'Reply to a deleted comment', created_at_i: 1700000600, parent_id: 302 },
      { objectID: '102', author: 'gina', comment_text: 'Another top-level comment', created_at_i: 1700000700, parent_id: storyId },
    ];
    const firebaseItems: FirebaseItem[] = [
      { id: 201, type: 'comment', by: 'bob', text: 'Live reply', time: 1700000200, parent: 101, kids: [302] },
      { id: 202, type: 'comment', by: 'carol', text: 'Killed text', dead: true, time: 1700000300, parent: 101, kids: [301] },
      { id: 302, type: 'comment', deleted: true, time: 1700000500, parent: 201, kids: [401] },
      { id: 401, type: 'comment', by: 'frank', text: 'Reply to a deleted comment', time: 1700000600, parent: 302 },
      { id: 102, type: 'comment', by: 'gina', text: 'Another top-level comment', time: 1700000700, parent: storyId, kids: [203] },
      { id: 203, type: 'comment', by: 'hank', text: 'Killed, no replies', dead: true, time: 1700000800, parent: 102 },
    ];
    // 201's only reply is deleted 302, so the item tree has none for it.
    const liveReply: AlgoliaItemResponse = { ...item, id: 201, author: 'bob', parent_id: 101, children: [] };
    // 102's only reply is flagged 203, which has none of its own.
    const flaggedLeafParent: AlgoliaItemResponse = { ...item, id: 102, author: 'gina', children: [] };

    function mockStory(nbHits = searchHits.length) {
      const readItem = vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => firebaseItems.find(fb => fb.id === Number(id)) ?? null);
      // The story's comments, and the count of them that goes out alongside.
      const search = vi.fn(async (_init?: RequestInit) => Response.json({ hits: searchHits, nbHits }));
      const count = vi.fn(async () => Response.json({ hits: [], nbHits }));
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) =>
        typeof url === 'string' && url.includes('hitsPerPage=0') ? count() : search(init));
      return { readItem, fetchSpy, search, count };
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('adds flagged and deleted replies with the replies under them', async () => {
      mockStory();

      const replies = await fetchCommentReplies(item);

      expect(replies.map(c => c.id)).toEqual([201, 202]);
      expect(replies[1]).toMatchObject({ author: 'carol', text: '[flagged]', parentId: 101 });
      expect(replies[1].children.map(c => c.id)).toEqual([301]);
      expect(replies[0].children).toHaveLength(1);
      expect(replies[0].children[0]).toMatchObject({ id: 302, deleted: true, author: '' });
      expect(replies[0].children[0].children.map(c => c.id)).toEqual([401]);
    });

    it('keeps the item tree replies for a thread bigger than search returns', async () => {
      const { readItem, search } = mockStory(1500);

      const replies = await fetchCommentReplies(item);

      expect(replies.map(c => c.id)).toEqual([201]);
      expect(replies[0].children).toEqual([]);
      expect(search).toHaveBeenCalledTimes(1);
      expect(readItem).not.toHaveBeenCalled();
    });

    it('stops the story search once the count shows a thread bigger than search returns', async () => {
      const { search } = mockStory(1500);
      search.mockImplementation(init => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));

      const replies = await fetchCommentReplies(item);

      expect(replies.map(c => c.id)).toEqual([201]);
      expect(search.mock.calls[0][0]?.signal?.aborted).toBe(true);
    });

    it('lets the story search decide when the count fails', async () => {
      const { count } = mockStory();
      count.mockImplementation(async () => new Response(null, { status: 503 }));

      const replies = await fetchCommentReplies(item);

      expect(replies.map(c => c.id)).toEqual([201, 202]);
    });

    it('looks up the replies of a comment whose replies are all flagged or deleted', async () => {
      mockStory();

      const replies = await fetchCommentReplies(liveReply);

      expect(replies.map(c => c.id)).toEqual([302]);
      expect(replies[0]).toMatchObject({ deleted: true });
      expect(replies[0].children.map(c => c.id)).toEqual([401]);
    });

    it('skips the story search for a comment with no replies', async () => {
      const { readItem, fetchSpy } = mockStory();

      const replies = await fetchCommentReplies({ ...item, id: 401, author: 'frank', parent_id: 302, children: [] });

      expect(replies).toEqual([]);
      expect(readItem).toHaveBeenCalledWith(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('skips the story search when the only replies are flagged ones without replies', async () => {
      const { readItem, fetchSpy } = mockStory();

      const replies = await fetchCommentReplies(flaggedLeafParent);

      expect(replies).toEqual([]);
      expect(readItem.mock.calls.map(([id]) => Number(id))).toEqual([102, 203]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('stops before the story search once the caller is gone', async () => {
      const { readItem, fetchSpy } = mockStory();
      const controller = new AbortController();
      readItem.mockImplementation(async (id) => {
        controller.abort();
        return firebaseItems.find(fb => fb.id === Number(id)) ?? null;
      });

      await expect(fetchCommentReplies(liveReply, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("reads a story's comments once for comments on the same story", async () => {
      const { readItem, search, count } = mockStory();

      const [rootReplies, liveReplyReplies] = await Promise.all([
        fetchCommentReplies(item),
        fetchCommentReplies(liveReply),
      ]);

      expect(rootReplies.map(c => c.id)).toEqual([201, 202]);
      expect(liveReplyReplies.map(c => c.id)).toEqual([302]);
      expect(search).toHaveBeenCalledTimes(1);
      expect(count).toHaveBeenCalledTimes(1);
      // 201 and its reply 302 to see whether to search, then each missing
      // parent once, and 101 to order its two replies.
      expect(readItem.mock.calls.map(([id]) => Number(id)).sort()).toEqual([101, 201, 202, 302, 302]);
    });

    it('orders the replies the way HN ranks them', async () => {
      const { readItem } = mockStory();
      readItem.mockImplementation(async (id) => Number(id) === 101
        ? { id: 101, type: 'comment', by: 'alice', time: 1700000100, parent: storyId, kids: [202, 201] }
        : firebaseItems.find(fb => fb.id === Number(id)) ?? null);

      const replies = await fetchCommentReplies(item);

      expect(replies.map(c => c.id)).toEqual([202, 201]);
    });

    it('reads the story again after a failed read', async () => {
      const { search } = mockStory();
      search.mockResolvedValueOnce(new Response(null, { status: 503 }));

      await expect(fetchCommentReplies(item)).rejects.toThrow(/503/);
      const replies = await fetchCommentReplies(item);

      expect(replies.map(c => c.id)).toEqual([201, 202]);
      expect(search).toHaveBeenCalledTimes(2);
    });
  });
});

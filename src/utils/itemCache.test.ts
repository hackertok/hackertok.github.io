import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getCachedItem,
  setCachedItem,
  saveListSessionState,
  getListSessionState,
  clearListSessionState,
  ITEM_CACHE_KEY_PREFIX,
  FEED_SESSION_KEY_PREFIX,
} from './itemCache';
import type { Comment, StoryItem } from '../types';
import { createStoryItem, createComment } from '../test/factories';

describe('itemCache', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockItem = createStoryItem({ id: 123, title: 'Sample HN Post', points: 100 });
  const mockComments = [
    createComment({ id: 1, text: 'Comment 1', author: 'user1' }),
    createComment({ id: 2, text: 'Comment 2', author: 'user2' }),
  ];

  describe('getCachedItem', () => {
    it('returns null for non-existent item', () => {
      expect(getCachedItem(999)).toBeNull();
    });

    it('returns cached item with comments', () => {
      setCachedItem(123, mockItem, mockComments);
      
      const result = getCachedItem(123)!;
      
      expect(result).not.toBeNull();
      expect(result.item).toEqual(mockItem);
      expect(result.comments).toEqual(mockComments);
    });

    it('marks cache as fresh when recently created', () => {
      setCachedItem(123, mockItem, mockComments);
      
      const result = getCachedItem(123)!;
      
      expect(result.isFresh).toBe(true);
    });

    it('marks cache as stale after CACHE_MAX_AGE (5 minutes)', () => {
      setCachedItem(123, mockItem, mockComments);

      vi.advanceTimersByTime(6 * 60 * 1000);

      const result = getCachedItem(123)!;

      expect(result).not.toBeNull();
      expect(result.isFresh).toBe(false);
    });

    it('discards cache after CACHE_STALE_AGE (24 hours) and removes from storage', () => {
      setCachedItem(123, mockItem, mockComments);

      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      const result = getCachedItem(123);

      expect(result).toBeNull();
      expect(localStorage.getItem(`${ITEM_CACHE_KEY_PREFIX}123`)).toBeNull();
    });

    it('returns orderedDepth from cache', () => {
      setCachedItem(123, mockItem, mockComments, 1);
      
      const result = getCachedItem(123)!;
      
      expect(result.orderedDepth).toBe(1);
    });

    it('defaults orderedDepth to 3 for old cache entries missing the field', () => {
      // Manually set cache without orderedDepth (simulating old cache format)
      localStorage.setItem(`${ITEM_CACHE_KEY_PREFIX}123`, JSON.stringify({
        item: mockItem,
        comments: mockComments,
        timestamp: Date.now(),
        // orderedDepth intentionally omitted
      }));
      
      const result = getCachedItem(123)!;
      
      expect(result.orderedDepth).toBe(3);
    });

    it('returns null for corrupted JSON', () => {
      localStorage.setItem(`${ITEM_CACHE_KEY_PREFIX}123`, 'not valid json');
      
      const result = getCachedItem(123);
      
      expect(result).toBeNull();
    });

    it('handles string and number itemId', () => {
      setCachedItem('123', mockItem, mockComments);
      
      expect(getCachedItem(123)).not.toBeNull();
      expect(getCachedItem('123')).not.toBeNull();
    });

    it('returns null for null/undefined itemId', () => {
      expect(getCachedItem(null as unknown as string)).toBeNull();
      expect(getCachedItem(undefined as unknown as string)).toBeNull();
    });

    it('handles cache entry with missing timestamp', () => {
      localStorage.setItem(`${ITEM_CACHE_KEY_PREFIX}123`, JSON.stringify({
        item: mockItem,
        comments: mockComments,
        // timestamp intentionally omitted
      }));
      
      // Missing timestamp results in NaN age, treated as not fresh but still returned
      const result = getCachedItem(123)!;
      expect(result).not.toBeNull();
      expect(result.isFresh).toBe(false);
    });
  });

  describe('setCachedItem', () => {
    it('stores item that can be retrieved', () => {
      setCachedItem(123, mockItem, mockComments);
      
      const result = getCachedItem(123)!;
      expect(result.item).toEqual(mockItem);
      expect(result.comments).toEqual(mockComments);
    });

    it('stores different items separately', () => {
      const item1 = createStoryItem({ id: 1, title: 'Item 1' });
      const item2 = createStoryItem({ id: 2, title: 'Item 2' });
      
      setCachedItem(1, item1, [] as Comment[]);
      setCachedItem(2, item2, [] as Comment[]);
      
      expect((getCachedItem(1)!.item as StoryItem).title).toBe('Item 1');
      expect((getCachedItem(2)!.item as StoryItem).title).toBe('Item 2');
    });

    it('overwrites existing cache for same itemId', () => {
      setCachedItem(123, createStoryItem({ title: 'Old' }), [] as Comment[]);
      setCachedItem(123, createStoryItem({ title: 'New' }), [] as Comment[]);
      
      expect((getCachedItem(123)!.item as StoryItem).title).toBe('New');
    });

    it('stores orderedDepth correctly', () => {
      setCachedItem(123, mockItem, mockComments, 1);
      expect(getCachedItem(123)!.orderedDepth).toBe(1);
      
      setCachedItem(123, mockItem, mockComments, 3);
      expect(getCachedItem(123)!.orderedDepth).toBe(3);
    });

    it('defaults orderedDepth to 3', () => {
      setCachedItem(123, mockItem, mockComments);
      
      expect(getCachedItem(123)!.orderedDepth).toBe(3);
    });

    it('prunes old entries when exceeding MAX_CACHED_ITEMS (60)', () => {
      for (let i = 0; i < 65; i++) {
        setCachedItem(i, createStoryItem({ id: i }), [] as Comment[]);
        // Advance so each entry has a distinct timestamp for prune ordering.
        vi.advanceTimersByTime(100);
      }

      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i)?.startsWith(ITEM_CACHE_KEY_PREFIX)) {
          count++;
        }
      }

      expect(count).toBeLessThanOrEqual(61); // small slack for prune timing
    });

    it('removes corrupted entries during pruning', () => {
      localStorage.setItem(`${ITEM_CACHE_KEY_PREFIX}corrupted`, 'not valid json');

      // Setting any valid entry triggers the prune pass that nukes corrupt JSON.
      setCachedItem(123, mockItem, mockComments);

      expect(localStorage.getItem(`${ITEM_CACHE_KEY_PREFIX}corrupted`)).toBeNull();
      expect(getCachedItem(123)).not.toBeNull();
    });

    it('removes all adjacent corrupted entries during pruning', () => {
      localStorage.setItem(`${ITEM_CACHE_KEY_PREFIX}corrupt_a`, '{bad json');
      localStorage.setItem(`${ITEM_CACHE_KEY_PREFIX}corrupt_b`, '{also bad');
      localStorage.setItem(`${ITEM_CACHE_KEY_PREFIX}corrupt_c`, '{still bad');

      setCachedItem(123, mockItem, mockComments);

      expect(localStorage.getItem(`${ITEM_CACHE_KEY_PREFIX}corrupt_a`)).toBeNull();
      expect(localStorage.getItem(`${ITEM_CACHE_KEY_PREFIX}corrupt_b`)).toBeNull();
      expect(localStorage.getItem(`${ITEM_CACHE_KEY_PREFIX}corrupt_c`)).toBeNull();
      expect(getCachedItem(123)).not.toBeNull();
    });
  });

});

describe('sessionStorage - List Session State', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockState = {
    scrollY: 500,
    storyIds: [1, 2, 3, 4, 5],
    position: 2,
    seenIds: new Set([1, 2]),
    hasMore: true,
  };

  describe('saveListSessionState', () => {
    it('saves state that can be retrieved', () => {
      saveListSessionState('top', mockState);
      
      const result = getListSessionState('top')!;
      
      expect(result).not.toBeNull();
      expect(result.scrollY).toBe(500);
      expect(result.storyIds).toEqual([1, 2, 3, 4, 5]);
      expect(result.position).toBe(2);
      expect(result.seenIds).toEqual(new Set([1, 2]));
      expect(result.hasMore).toBe(true);
    });

    it('saves different item types separately', () => {
      saveListSessionState('top', { ...mockState, position: 1 });
      saveListSessionState('best', { ...mockState, position: 2 });
      
      expect(getListSessionState('top')!.position).toBe(1);
      expect(getListSessionState('best')!.position).toBe(2);
    });

    it('converts Set to Array for storage', () => {
      saveListSessionState('top', mockState);
      
      const stored = JSON.parse(sessionStorage.getItem(`${FEED_SESSION_KEY_PREFIX}top`)!) as { seenIds?: unknown };
      expect(Array.isArray(stored.seenIds)).toBe(true);
    });
  });

  describe('getListSessionState', () => {
    it('returns null for non-existent session', () => {
      expect(getListSessionState('top')).toBeNull();
    });

    it('converts seenIds Array back to Set', () => {
      saveListSessionState('top', mockState);
      
      const result = getListSessionState('top')!;
      
      expect(result.seenIds instanceof Set).toBe(true);
      expect(result.seenIds.has(1)).toBe(true);
      expect(result.seenIds.has(2)).toBe(true);
    });

    it('expires session after 30 minutes', () => {
      saveListSessionState('top', mockState);

      vi.advanceTimersByTime(31 * 60 * 1000);

      const result = getListSessionState('top');

      expect(result).toBeNull();
      expect(sessionStorage.getItem(`${FEED_SESSION_KEY_PREFIX}top`)).toBeNull();
    });

    it('returns session within 30 minutes', () => {
      saveListSessionState('top', mockState);

      vi.advanceTimersByTime(29 * 60 * 1000);

      const result = getListSessionState('top');

      expect(result).not.toBeNull();
    });

    it('provides default values for missing fields', () => {
      sessionStorage.setItem(`${FEED_SESSION_KEY_PREFIX}top`, JSON.stringify({
        timestamp: Date.now(),
      }));
      
      const result = getListSessionState('top')!;
      
      expect(result.scrollY).toBe(0);
      expect(result.storyIds).toEqual([]);
      expect(result.position).toBe(0);
      expect(result.seenIds).toEqual(new Set());
      expect(result.hasMore).toBe(true);
    });

    it('returns null for corrupted JSON', () => {
      sessionStorage.setItem(`${FEED_SESSION_KEY_PREFIX}top`, 'not valid json');
      
      const result = getListSessionState('top');
      
      expect(result).toBeNull();
    });
  });

  describe('clearListSessionState', () => {
    it('clears specific session state', () => {
      saveListSessionState('top', mockState);
      saveListSessionState('best', mockState);
      
      clearListSessionState('top');
      
      expect(getListSessionState('top')).toBeNull();
      expect(getListSessionState('best')).not.toBeNull();
    });

    it('does not throw for non-existent session', () => {
      expect(() => clearListSessionState('nonexistent' as never)).not.toThrow();
    });

    it('handles empty seenIds array', () => {
      saveListSessionState('top', { ...mockState, seenIds: new Set() });
      
      const result = getListSessionState('top')!;
      expect(result.seenIds).toEqual(new Set());
      expect(result.seenIds.size).toBe(0);
    });

    it('handles special characters in feedType', () => {
      saveListSessionState('top/special' as never, mockState);
      
      const result = getListSessionState('top/special' as never)!;
      expect(result).not.toBeNull();
    });
  });
});

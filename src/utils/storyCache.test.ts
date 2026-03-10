import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getCachedStory,
  setCachedStory,
  saveListSessionState,
  getListSessionState,
  clearListSessionState,
} from './storyCache';
import type { Comment } from '../types';
import { createStory, createComment } from '../test/factories';

describe('storyCache', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockStory = createStory({ id: 123, title: 'Test Story', points: 100 });
  const mockComments = [
    createComment({ id: 1, text: 'Comment 1', author: 'user1' }),
    createComment({ id: 2, text: 'Comment 2', author: 'user2' }),
  ];

  describe('getCachedStory', () => {
    it('returns null for non-existent story', () => {
      expect(getCachedStory(999)).toBeNull();
    });

    it('returns cached story with comments', () => {
      setCachedStory(123, mockStory, mockComments);
      
      const result = getCachedStory(123)!;
      
      expect(result).not.toBeNull();
      expect(result.story).toEqual(mockStory);
      expect(result.comments).toEqual(mockComments);
    });

    it('marks cache as fresh when recently created', () => {
      setCachedStory(123, mockStory, mockComments);
      
      const result = getCachedStory(123)!;
      
      expect(result.isFresh).toBe(true);
    });

    it('marks cache as stale after CACHE_MAX_AGE (5 minutes)', () => {
      setCachedStory(123, mockStory, mockComments);
      
      // Advance time by 6 minutes
      vi.advanceTimersByTime(6 * 60 * 1000);
      
      const result = getCachedStory(123)!;
      
      expect(result).not.toBeNull();
      expect(result.isFresh).toBe(false);
    });

    it('discards cache after CACHE_STALE_AGE (24 hours) and removes from storage', () => {
      setCachedStory(123, mockStory, mockComments);
      
      // Advance time by 25 hours
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);
      
      const result = getCachedStory(123);
      
      expect(result).toBeNull();
      // Verify it was removed from localStorage
      expect(localStorage.getItem('hackertok_story_123')).toBeNull();
    });

    it('returns orderedDepth from cache', () => {
      setCachedStory(123, mockStory, mockComments, 1);
      
      const result = getCachedStory(123)!;
      
      expect(result.orderedDepth).toBe(1);
    });

    it('defaults orderedDepth to 3 for old cache entries missing the field', () => {
      // Manually set cache without orderedDepth (simulating old cache format)
      localStorage.setItem('hackertok_story_123', JSON.stringify({
        story: mockStory,
        comments: mockComments,
        timestamp: Date.now(),
        // orderedDepth intentionally omitted
      }));
      
      const result = getCachedStory(123)!;
      
      expect(result.orderedDepth).toBe(3);
    });

    it('returns null for corrupted JSON', () => {
      localStorage.setItem('hackertok_story_123', 'not valid json');
      
      const result = getCachedStory(123);
      
      expect(result).toBeNull();
    });

    it('handles string and number storyId', () => {
      setCachedStory('123', mockStory, mockComments);
      
      expect(getCachedStory(123)).not.toBeNull();
      expect(getCachedStory('123')).not.toBeNull();
    });

    it('returns null for null/undefined storyId', () => {
      expect(getCachedStory(null as unknown as string)).toBeNull();
      expect(getCachedStory(undefined as unknown as string)).toBeNull();
    });

    it('handles cache entry with missing timestamp', () => {
      localStorage.setItem('hackertok_story_123', JSON.stringify({
        story: mockStory,
        comments: mockComments,
        // timestamp intentionally omitted
      }));
      
      // Missing timestamp results in NaN age, treated as not fresh but still returned
      const result = getCachedStory(123)!;
      expect(result).not.toBeNull();
      expect(result.isFresh).toBe(false);
    });
  });

  describe('setCachedStory', () => {
    it('stores story that can be retrieved', () => {
      setCachedStory(123, mockStory, mockComments);
      
      const result = getCachedStory(123)!;
      expect(result.story).toEqual(mockStory);
      expect(result.comments).toEqual(mockComments);
    });

    it('stores different stories separately', () => {
      const story1 = createStory({ id: 1, title: 'Story 1' });
      const story2 = createStory({ id: 2, title: 'Story 2' });
      
      setCachedStory(1, story1, [] as Comment[]);
      setCachedStory(2, story2, [] as Comment[]);
      
      expect(getCachedStory(1)!.story.title).toBe('Story 1');
      expect(getCachedStory(2)!.story.title).toBe('Story 2');
    });

    it('overwrites existing cache for same storyId', () => {
      setCachedStory(123, createStory({ title: 'Old' }), [] as Comment[]);
      setCachedStory(123, createStory({ title: 'New' }), [] as Comment[]);
      
      expect(getCachedStory(123)!.story.title).toBe('New');
    });

    it('stores orderedDepth correctly', () => {
      setCachedStory(123, mockStory, mockComments, 1);
      expect(getCachedStory(123)!.orderedDepth).toBe(1);
      
      setCachedStory(123, mockStory, mockComments, 3);
      expect(getCachedStory(123)!.orderedDepth).toBe(3);
    });

    it('defaults orderedDepth to 3', () => {
      setCachedStory(123, mockStory, mockComments);
      
      expect(getCachedStory(123)!.orderedDepth).toBe(3);
    });

    it('prunes old entries when exceeding MAX_CACHED_STORIES (60)', () => {
      // Add 65 stories
      for (let i = 0; i < 65; i++) {
        setCachedStory(i, createStory({ id: i }), [] as Comment[]);
        // Advance time slightly so each has different timestamp
        vi.advanceTimersByTime(100);
      }
      
      // Count remaining story cache entries
      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i)?.startsWith('hackertok_story_')) {
          count++;
        }
      }
      
      // Should have pruned down to ~60
      expect(count).toBeLessThanOrEqual(61); // Allow some slack for timing
    });

    it('removes corrupted entries during pruning', () => {
      // Add corrupted entry
      localStorage.setItem('hackertok_story_corrupted', 'not valid json');
      
      // Add valid entry (triggers prune)
      setCachedStory(123, mockStory, mockComments);
      
      // Corrupted entry should be removed
      expect(localStorage.getItem('hackertok_story_corrupted')).toBeNull();
      // Valid entry should exist
      expect(getCachedStory(123)).not.toBeNull();
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

    it('saves different story types separately', () => {
      saveListSessionState('top', { ...mockState, position: 1 });
      saveListSessionState('best', { ...mockState, position: 2 });
      
      expect(getListSessionState('top')!.position).toBe(1);
      expect(getListSessionState('best')!.position).toBe(2);
    });

    it('converts Set to Array for storage', () => {
      saveListSessionState('top', mockState);
      
      const stored = JSON.parse(sessionStorage.getItem('hackertok_session_top')!) as { seenIds?: unknown };
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
      
      // Advance time by 31 minutes
      vi.advanceTimersByTime(31 * 60 * 1000);
      
      const result = getListSessionState('top');
      
      expect(result).toBeNull();
       
      // Verify it was removed from sessionStorage
      expect(sessionStorage.getItem('hackertok_session_top')).toBeNull();
    });

    it('returns session within 30 minutes', () => {
      saveListSessionState('top', mockState);
      
      // Advance time by 29 minutes
      vi.advanceTimersByTime(29 * 60 * 1000);
      
      const result = getListSessionState('top');
      
      expect(result).not.toBeNull();
    });

    it('provides default values for missing fields', () => {
      // Manually set minimal session data
      sessionStorage.setItem('hackertok_session_top', JSON.stringify({
        timestamp: Date.now(),
        // Missing most fields
      }));
      
      const result = getListSessionState('top')!;
      
      expect(result.scrollY).toBe(0);
      expect(result.storyIds).toEqual([]);
      expect(result.position).toBe(0);
      expect(result.seenIds).toEqual(new Set());
      expect(result.hasMore).toBe(true);
    });

    it('returns null for corrupted JSON', () => {
      sessionStorage.setItem('hackertok_session_top', 'not valid json');
      
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

    it('handles special characters in storyType', () => {
      saveListSessionState('top/special' as never, mockState);
      
      const result = getListSessionState('top/special' as never)!;
      expect(result).not.toBeNull();
    });
  });
});

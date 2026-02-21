import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedStories, setCachedStories, clearStoriesCache, isCacheFresh } from './storiesCache';

describe('storiesCache', () => {
  beforeEach(() => {
    clearStoriesCache();
  });

  const mockStories = [
    { id: 1, title: 'Story 1', points: 100 },
    { id: 2, title: 'Story 2', points: 200 },
    { id: 3, title: 'Story 3', points: 300 },
  ];

  describe('setCachedStories', () => {
    it('stores stories that can be retrieved', () => {
      setCachedStories('top', mockStories);
      
      const result = getCachedStories('top');
      expect(result).not.toBeNull();
      expect(result.stories).toEqual(mockStories);
    });

    it('stores different cache types separately', () => {
      setCachedStories('top', [{ id: 1, title: 'Top Story' }]);
      setCachedStories('best', [{ id: 2, title: 'Best Story' }]);
      
      const topResult = getCachedStories('top');
      const bestResult = getCachedStories('best');
      
      expect(topResult.stories[0].title).toBe('Top Story');
      expect(bestResult.stories[0].title).toBe('Best Story');
    });
  });

  describe('getCachedStories', () => {
    it('returns null when no cache exists', () => {
      expect(getCachedStories('top')).toBeNull();
    });

    it('returns cached stories with metadata', () => {
      setCachedStories('top', mockStories);
      
      const result = getCachedStories('top');
      
      expect(result).not.toBeNull();
      expect(result.stories).toEqual(mockStories);
      expect(result.timestamp).toBeDefined();
      expect(typeof result.isStale).toBe('boolean');
    });

    it('marks cache as fresh when recently created', () => {
      setCachedStories('top', mockStories);
      
      const result = getCachedStories('top');
      
      expect(result.isStale).toBe(false);
    });
  });

  describe('clearStoriesCache', () => {
    beforeEach(() => {
      setCachedStories('top', mockStories);
      setCachedStories('best', mockStories);
    });

    it('clears specific cache type', () => {
      expect(getCachedStories('top')).not.toBeNull();
      expect(getCachedStories('best')).not.toBeNull();
      
      clearStoriesCache('top');
      
      expect(getCachedStories('top')).toBeNull();
      expect(getCachedStories('best')).not.toBeNull();
    });

    it('clears all caches when no type specified', () => {
      clearStoriesCache();
      
      expect(getCachedStories('top')).toBeNull();
      expect(getCachedStories('best')).toBeNull();
    });
  });

  describe('isCacheFresh', () => {
    it('returns false when no cache exists', () => {
      expect(isCacheFresh('top')).toBe(false);
    });

    it('returns true for fresh cache', () => {
      setCachedStories('top', mockStories);
      expect(isCacheFresh('top')).toBe(true);
    });
  });
});

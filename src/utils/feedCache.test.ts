import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedFeed, setCachedFeed, clearFeedCache, isCacheFresh } from './feedCache';
import { createStoryItem } from '../test/factories';

describe('feedCache', () => {
  beforeEach(() => {
    clearFeedCache();
  });

  const mockStories = [
    createStoryItem({ id: 1, title: 'Story 1', points: 100 }),
    createStoryItem({ id: 2, title: 'Story 2', points: 200 }),
    createStoryItem({ id: 3, title: 'Story 3', points: 300 }),
  ];

  describe('setCachedFeed', () => {
    it('stores stories that can be retrieved', () => {
      setCachedFeed('top', mockStories);
      
      const result = getCachedFeed('top')!;
      expect(result).not.toBeNull();
      expect(result.stories).toEqual(mockStories);
    });

    it('stores different cache types separately', () => {
      setCachedFeed('top', [createStoryItem({ id: 1, title: 'Top Story' })]);
      setCachedFeed('best', [createStoryItem({ id: 2, title: 'Best Story' })]);
      
      const topResult = getCachedFeed('top')!;
      const bestResult = getCachedFeed('best')!;
      
      expect(topResult.stories[0].title).toBe('Top Story');
      expect(bestResult.stories[0].title).toBe('Best Story');
    });
  });

  describe('getCachedFeed', () => {
    it('returns null when no cache exists', () => {
      expect(getCachedFeed('top')).toBeNull();
    });

    it('returns cached stories with metadata', () => {
      setCachedFeed('top', mockStories);
      
      const result = getCachedFeed('top')!;
      
      expect(result).not.toBeNull();
      expect(result.stories).toEqual(mockStories);
      expect(result.timestamp).toBeDefined();
      expect(typeof result.isStale).toBe('boolean');
    });

    it('marks cache as fresh when recently created', () => {
      setCachedFeed('top', mockStories);
      
      const result = getCachedFeed('top')!;
      
      expect(result.isStale).toBe(false);
    });
  });

  describe('clearFeedCache', () => {
    beforeEach(() => {
      setCachedFeed('top', mockStories);
      setCachedFeed('best', mockStories);
    });

    it('clears specific cache type', () => {
      expect(getCachedFeed('top')).not.toBeNull();
      expect(getCachedFeed('best')).not.toBeNull();
      
      clearFeedCache('top');
      
      expect(getCachedFeed('top')).toBeNull();
      expect(getCachedFeed('best')).not.toBeNull();
    });

    it('clears all caches when no type specified', () => {
      clearFeedCache();
      
      expect(getCachedFeed('top')).toBeNull();
      expect(getCachedFeed('best')).toBeNull();
    });
  });

  describe('isCacheFresh', () => {
    it('returns false when no cache exists', () => {
      expect(isCacheFresh('top')).toBe(false);
    });

    it('returns true for fresh cache', () => {
      setCachedFeed('top', mockStories);
      expect(isCacheFresh('top')).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { isViewed, markViewed, clearViewed } from './viewedStories';

describe('viewedStories', () => {
  beforeEach(() => {
    clearViewed();
  });

  describe('isViewed', () => {
    it('returns false for unviewed story', () => {
      expect(isViewed(12345)).toBe(false);
    });

    it('returns true for viewed story', () => {
      markViewed(12345);
      expect(isViewed(12345)).toBe(true);
    });

    it('handles string IDs', () => {
      markViewed('12345');
      expect(isViewed('12345')).toBe(true);
      expect(isViewed(12345)).toBe(true);
    });

    it('handles number IDs', () => {
      markViewed(12345);
      expect(isViewed(12345)).toBe(true);
      expect(isViewed('12345')).toBe(true);
    });
  });

  describe('markViewed', () => {
    it('marks a story as viewed', () => {
      expect(isViewed(99999)).toBe(false);
      markViewed(99999);
      expect(isViewed(99999)).toBe(true);
    });

    it('handles multiple different stories', () => {
      markViewed(1);
      markViewed(2);
      markViewed(3);
      
      expect(isViewed(1)).toBe(true);
      expect(isViewed(2)).toBe(true);
      expect(isViewed(3)).toBe(true);
      expect(isViewed(4)).toBe(false);
    });

    it('is idempotent - marking same story twice has no effect', () => {
      markViewed(12345);
      expect(isViewed(12345)).toBe(true);
      
      markViewed(12345);
      expect(isViewed(12345)).toBe(true);
    });
  });

  describe('clearViewed', () => {
    it('clears all viewed stories', () => {
      markViewed(1);
      markViewed(2);
      markViewed(3);
      
      expect(isViewed(1)).toBe(true);
      
      clearViewed();
      
      expect(isViewed(1)).toBe(false);
      expect(isViewed(2)).toBe(false);
      expect(isViewed(3)).toBe(false);
    });
  });
});

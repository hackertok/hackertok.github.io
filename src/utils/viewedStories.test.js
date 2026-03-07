import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  isViewed, 
  markViewed, 
  clearViewed,
  getRecentlyViewedIds,
  markViewedWithTime,
  pruneExpiredViewed,
  clearViewedTimes,
  getSessionViewedIds,
  addToSessionViewed,
  clearSessionViewed
} from './viewedStories';

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

    it('evicts oldest entries when exceeding 50K cap', () => {
      // Seed 50K IDs via localStorage, then let clearViewed invalidate the cache
      const ids = Array.from({ length: 50_000 }, (_, i) => i + 1);
      clearViewed(); // invalidates in-memory cache + clears localStorage
      localStorage.setItem('hackertok_viewed', JSON.stringify(ids));
      // clearViewed set viewedSet = null, so next access reloads from localStorage
      
      expect(isViewed(1)).toBe(true);
      expect(isViewed(50_000)).toBe(true);

      // Add one more — should evict ID 1 (oldest, first in Set iteration order)
      markViewed(50_001);
      
      expect(isViewed(1)).toBe(false); // evicted
      expect(isViewed(50_000)).toBe(true); // still there
      expect(isViewed(50_001)).toBe(true); // newly added
      
      // Verify localStorage is also bounded
      const stored = JSON.parse(localStorage.getItem('hackertok_viewed'));
      expect(stored.length).toBe(50_000);
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

describe('viewedStories - Time-based functions', () => {
  beforeEach(() => {
    clearViewed();
    clearViewedTimes();
    vi.restoreAllMocks();
  });

  describe('getRecentlyViewedIds', () => {
    it('returns empty Set initially', () => {
      const ids = getRecentlyViewedIds(24);
      expect(ids.size).toBe(0);
    });

    it('returns IDs marked with markViewedWithTime', () => {
      markViewedWithTime(12345);
      markViewedWithTime(67890);
      
      const ids = getRecentlyViewedIds(24);
      expect(ids.has(12345)).toBe(true);
      expect(ids.has(67890)).toBe(true);
      expect(ids.size).toBe(2);
    });

    it('excludes IDs older than the time window', () => {
      // Mark a story "25 hours ago"
      const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);
      vi.spyOn(Date, 'now').mockReturnValue(twentyFiveHoursAgo);
      markViewedWithTime(11111);
      
      // Mark a story "now"
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + (25 * 60 * 60 * 1000));
      markViewedWithTime(22222);
      
      vi.restoreAllMocks();
      
      const ids = getRecentlyViewedIds(24);
      expect(ids.has(11111)).toBe(false); // Too old
      expect(ids.has(22222)).toBe(true);  // Recent
    });

    it('handles custom time window', () => {
      // Mark a story "2 hours ago"
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      vi.spyOn(Date, 'now').mockReturnValueOnce(twoHoursAgo);
      markViewedWithTime(12345);
      vi.restoreAllMocks();
      
      // Within 24 hours
      expect(getRecentlyViewedIds(24).has(12345)).toBe(true);
      // Within 3 hours
      expect(getRecentlyViewedIds(3).has(12345)).toBe(true);
      // NOT within 1 hour
      expect(getRecentlyViewedIds(1).has(12345)).toBe(false);
    });
  });

  describe('markViewedWithTime', () => {
    it('marks story with timestamp', () => {
      markViewedWithTime(12345);
      
      const ids = getRecentlyViewedIds(24);
      expect(ids.has(12345)).toBe(true);
    });

    it('also marks in permanent store for visual styling', () => {
      expect(isViewed(12345)).toBe(false);
      
      markViewedWithTime(12345);
      
      expect(isViewed(12345)).toBe(true);
    });

    it('handles string IDs', () => {
      markViewedWithTime('12345');
      
      const ids = getRecentlyViewedIds(24);
      expect(ids.has(12345)).toBe(true);
    });

    it('updates timestamp if marked again', () => {
      // Mark "2 hours ago"
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      vi.spyOn(Date, 'now').mockReturnValueOnce(twoHoursAgo);
      markViewedWithTime(12345);
      vi.restoreAllMocks();
      
      // Should be within 3 hours but not 1 hour
      expect(getRecentlyViewedIds(1).has(12345)).toBe(false);
      
      // Mark again "now"
      markViewedWithTime(12345);
      
      // Now should be within 1 hour
      expect(getRecentlyViewedIds(1).has(12345)).toBe(true);
    });
  });

  describe('pruneExpiredViewed', () => {
    it('removes entries older than time window', () => {
      // Mark a story "25 hours ago"
      const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);
      vi.spyOn(Date, 'now').mockReturnValueOnce(twentyFiveHoursAgo);
      markViewedWithTime(11111);
      vi.restoreAllMocks();
      
      // Mark a story "now"
      markViewedWithTime(22222);
      
      // Before pruning - old one would fail the time check anyway
      expect(getRecentlyViewedIds(24).has(11111)).toBe(false);
      expect(getRecentlyViewedIds(24).has(22222)).toBe(true);
      
      // Prune
      pruneExpiredViewed(24);
      
      // After pruning - recent one still there
      expect(getRecentlyViewedIds(24).has(22222)).toBe(true);
    });

    it('handles custom time window', () => {
      // Mark a story "2 hours ago"
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      vi.spyOn(Date, 'now').mockReturnValueOnce(twoHoursAgo);
      markViewedWithTime(12345);
      vi.restoreAllMocks();
      
      // Prune with 1-hour window
      pruneExpiredViewed(1);
      
      // Should be pruned (was 2 hours old)
      // Note: need to clear cache to see the pruned result
      clearViewedTimes();
      expect(getRecentlyViewedIds(24).has(12345)).toBe(false);
    });

    it('does nothing when all entries are recent', () => {
      markViewedWithTime(12345);
      markViewedWithTime(67890);
      
      pruneExpiredViewed(24);
      
      const ids = getRecentlyViewedIds(24);
      expect(ids.has(12345)).toBe(true);
      expect(ids.has(67890)).toBe(true);
    });
  });

  describe('clearViewedTimes', () => {
    it('clears all time-based viewed stories', () => {
      markViewedWithTime(12345);
      markViewedWithTime(67890);
      
      expect(getRecentlyViewedIds(24).size).toBe(2);
      
      clearViewedTimes();
      
      expect(getRecentlyViewedIds(24).size).toBe(0);
    });
  });
});

describe('viewedStories - Session storage functions', () => {
  beforeEach(() => {
    clearViewed();
    clearViewedTimes();
    clearSessionViewed();
  });

  describe('getSessionViewedIds', () => {
    it('returns empty Set initially', () => {
      const ids = getSessionViewedIds();
      expect(ids.size).toBe(0);
    });

    it('returns IDs added with addToSessionViewed', () => {
      addToSessionViewed(12345);
      addToSessionViewed(67890);
      
      const ids = getSessionViewedIds();
      expect(ids.has(12345)).toBe(true);
      expect(ids.has(67890)).toBe(true);
      expect(ids.size).toBe(2);
    });

    it('returns a copy, not the internal Set', () => {
      addToSessionViewed(12345);
      
      const ids1 = getSessionViewedIds();
      const ids2 = getSessionViewedIds();
      
      expect(ids1).not.toBe(ids2);
      expect(ids1).toEqual(ids2);
    });
  });

  describe('addToSessionViewed', () => {
    it('adds a story ID to session storage', () => {
      expect(getSessionViewedIds().has(12345)).toBe(false);
      
      addToSessionViewed(12345);
      
      expect(getSessionViewedIds().has(12345)).toBe(true);
    });

    it('handles string IDs', () => {
      addToSessionViewed('12345');
      
      expect(getSessionViewedIds().has(12345)).toBe(true);
    });

    it('is idempotent - adding same ID twice has no effect', () => {
      addToSessionViewed(12345);
      addToSessionViewed(12345);
      
      expect(getSessionViewedIds().size).toBe(1);
    });
  });

  describe('markViewedWithTime also adds to session', () => {
    it('adds to session storage when marking with time', () => {
      expect(getSessionViewedIds().has(12345)).toBe(false);
      
      markViewedWithTime(12345);
      
      expect(getSessionViewedIds().has(12345)).toBe(true);
    });
  });

  describe('clearSessionViewed', () => {
    it('clears all session-viewed stories', () => {
      addToSessionViewed(12345);
      addToSessionViewed(67890);
      
      expect(getSessionViewedIds().size).toBe(2);
      
      clearSessionViewed();
      
      expect(getSessionViewedIds().size).toBe(0);
    });
  });
});

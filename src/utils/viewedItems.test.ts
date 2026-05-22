import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  isViewed, 
  markViewed, 
  clearViewed,
  getFilteredViewedIds,
  markViewedWithTime,
  pruneExpiredViewed,
  clearViewedTimes,
  getSessionViewedIds,
  addToSessionViewed,
  clearSessionViewed,
  VIEWED_KEY,
  VIEWED_TITLE_TIMES_KEY,
  VIEWED_DETAIL_TIMES_KEY,
  TITLE_CLICK_TTL_HOURS,
  DETAIL_VIEW_TTL_HOURS,
} from './viewedItems';

describe('viewedItems', () => {
  beforeEach(() => {
    clearViewed();
  });

  describe('isViewed', () => {
    it('returns false for unviewed item', () => {
      expect(isViewed(12345)).toBe(false);
    });

    it('returns true for viewed item', () => {
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
    it('marks an item as viewed', () => {
      expect(isViewed(99999)).toBe(false);
      markViewed(99999);
      expect(isViewed(99999)).toBe(true);
    });

    it('handles multiple different items', () => {
      markViewed(1);
      markViewed(2);
      markViewed(3);
      
      expect(isViewed(1)).toBe(true);
      expect(isViewed(2)).toBe(true);
      expect(isViewed(3)).toBe(true);
      expect(isViewed(4)).toBe(false);
    });

    it('is idempotent - marking same item twice has no effect', () => {
      markViewed(12345);
      expect(isViewed(12345)).toBe(true);
      
      markViewed(12345);
      expect(isViewed(12345)).toBe(true);
    });

    it('evicts oldest entries when exceeding 50K cap', () => {
      // Seed 50K IDs via localStorage, then let clearViewed invalidate the cache
      const ids = Array.from({ length: 50_000 }, (_, i) => i + 1);
      clearViewed(); // invalidates in-memory cache + clears localStorage
      localStorage.setItem(VIEWED_KEY, JSON.stringify(ids));
      // clearViewed set viewedSet = null, so next access reloads from localStorage
      
      expect(isViewed(1)).toBe(true);
      expect(isViewed(50_000)).toBe(true);

      // Add one more — should evict ID 1 (oldest, first in Set iteration order)
      markViewed(50_001);
      
      expect(isViewed(1)).toBe(false); // evicted
      expect(isViewed(50_000)).toBe(true); // still there
      expect(isViewed(50_001)).toBe(true); // newly added
      
      // Verify localStorage is also bounded
      const stored = JSON.parse(localStorage.getItem(VIEWED_KEY)!) as number[];
      expect(stored.length).toBe(50_000);
    });
  });

  describe('clearViewed', () => {
    it('clears all viewed items', () => {
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

describe('viewedItems - Time-based functions', () => {
  beforeEach(() => {
    clearViewed();
    clearViewedTimes();
    vi.restoreAllMocks();
  });

  describe('getFilteredViewedIds', () => {
    it('returns empty Set initially', () => {
      const ids = getFilteredViewedIds();
      expect(ids.size).toBe(0);
    });

    it('returns IDs from title map within 5-day TTL', () => {
      markViewedWithTime(12345, 'title');
      markViewedWithTime(67890, 'title');

      const ids = getFilteredViewedIds();
      expect(ids.has(12345)).toBe(true);
      expect(ids.has(67890)).toBe(true);
      expect(ids.size).toBe(2);
    });

    it('returns IDs from detail map within 12-hour TTL', () => {
      markViewedWithTime(11111, 'detail');
      markViewedWithTime(22222, 'detail');

      const ids = getFilteredViewedIds();
      expect(ids.has(11111)).toBe(true);
      expect(ids.has(22222)).toBe(true);
    });

    it('excludes title IDs older than 5 days', () => {
      const sixDaysAgo = Date.now() - (6 * 24 * 60 * 60 * 1000);
      vi.spyOn(Date, 'now').mockReturnValueOnce(sixDaysAgo);
      markViewedWithTime(11111, 'title');
      vi.restoreAllMocks();

      markViewedWithTime(22222, 'title');

      const ids = getFilteredViewedIds();
      expect(ids.has(11111)).toBe(false);
      expect(ids.has(22222)).toBe(true);
    });

    it('excludes detail IDs older than 12 hours', () => {
      const thirteenHoursAgo = Date.now() - (13 * 60 * 60 * 1000);
      vi.spyOn(Date, 'now').mockReturnValueOnce(thirteenHoursAgo);
      markViewedWithTime(11111, 'detail');
      vi.restoreAllMocks();

      markViewedWithTime(22222, 'detail');

      const ids = getFilteredViewedIds();
      expect(ids.has(11111)).toBe(false);
      expect(ids.has(22222)).toBe(true);
    });

    it('returns union of both maps', () => {
      markViewedWithTime(11111, 'title');
      markViewedWithTime(22222, 'detail');

      const ids = getFilteredViewedIds();
      expect(ids.has(11111)).toBe(true);
      expect(ids.has(22222)).toBe(true);
      expect(ids.size).toBe(2);
    });
  });

  describe('markViewedWithTime', () => {
    it('writes to title map when kind is title', () => {
      markViewedWithTime(12345, 'title');

      const stored = JSON.parse(localStorage.getItem(VIEWED_TITLE_TIMES_KEY)!) as Record<string, number>;
      expect(stored['12345']).toBeGreaterThan(0);
      expect(localStorage.getItem(VIEWED_DETAIL_TIMES_KEY)).toBeNull();
    });

    it('writes to detail map when kind is detail', () => {
      markViewedWithTime(12345, 'detail');

      const stored = JSON.parse(localStorage.getItem(VIEWED_DETAIL_TIMES_KEY)!) as Record<string, number>;
      expect(stored['12345']).toBeGreaterThan(0);
      expect(localStorage.getItem(VIEWED_TITLE_TIMES_KEY)).toBeNull();
    });

    it('defaults to detail when no kind specified', () => {
      markViewedWithTime(12345);

      const stored = JSON.parse(localStorage.getItem(VIEWED_DETAIL_TIMES_KEY)!) as Record<string, number>;
      expect(stored['12345']).toBeGreaterThan(0);
      expect(localStorage.getItem(VIEWED_TITLE_TIMES_KEY)).toBeNull();
    });

    it('also marks in permanent store for visual styling (title only)', () => {
      expect(isViewed(12345)).toBe(false);

      markViewedWithTime(12345, 'title');

      expect(isViewed(12345)).toBe(true);
    });

    it('does not mark permanent store for detail views', () => {
      expect(isViewed(12345)).toBe(false);

      markViewedWithTime(12345, 'detail');

      expect(isViewed(12345)).toBe(false);
    });

    it('handles string IDs', () => {
      markViewedWithTime('12345', 'title');

      const ids = getFilteredViewedIds();
      expect(ids.has(12345)).toBe(true);
    });

    it('updates timestamp if marked again', () => {
      const thirteenHoursAgo = Date.now() - (13 * 60 * 60 * 1000);
      vi.spyOn(Date, 'now').mockReturnValueOnce(thirteenHoursAgo);
      markViewedWithTime(12345, 'detail');
      vi.restoreAllMocks();

      // Expired
      expect(getFilteredViewedIds().has(12345)).toBe(false);

      // Re-mark — fresh timestamp
      markViewedWithTime(12345, 'detail');

      expect(getFilteredViewedIds().has(12345)).toBe(true);
    });
  });

  describe('pruneExpiredViewed', () => {
    it('removes title entries older than TITLE_CLICK_TTL_HOURS', () => {
      const sixDaysAgo = Date.now() - (TITLE_CLICK_TTL_HOURS + 1) * 3_600_000;
      vi.spyOn(Date, 'now').mockReturnValueOnce(sixDaysAgo);
      markViewedWithTime(11111, 'title');
      vi.restoreAllMocks();

      markViewedWithTime(22222, 'title');

      pruneExpiredViewed();

      const ids = getFilteredViewedIds();
      expect(ids.has(11111)).toBe(false);
      expect(ids.has(22222)).toBe(true);
    });

    it('removes detail entries older than DETAIL_VIEW_TTL_HOURS', () => {
      const thirteenHoursAgo = Date.now() - (DETAIL_VIEW_TTL_HOURS + 1) * 3_600_000;
      vi.spyOn(Date, 'now').mockReturnValueOnce(thirteenHoursAgo);
      markViewedWithTime(11111, 'detail');
      vi.restoreAllMocks();

      markViewedWithTime(22222, 'detail');

      pruneExpiredViewed();

      const ids = getFilteredViewedIds();
      expect(ids.has(11111)).toBe(false);
      expect(ids.has(22222)).toBe(true);
    });

    it('does nothing when all entries are recent', () => {
      markViewedWithTime(12345, 'title');
      markViewedWithTime(67890, 'detail');

      pruneExpiredViewed();

      const ids = getFilteredViewedIds();
      expect(ids.has(12345)).toBe(true);
      expect(ids.has(67890)).toBe(true);
    });
  });

  describe('clearViewedTimes', () => {
    it('clears both title and detail maps', () => {
      markViewedWithTime(12345, 'title');
      markViewedWithTime(67890, 'detail');

      expect(getFilteredViewedIds().size).toBe(2);

      clearViewedTimes();

      expect(getFilteredViewedIds().size).toBe(0);
      expect(localStorage.getItem(VIEWED_TITLE_TIMES_KEY)).toBeNull();
      expect(localStorage.getItem(VIEWED_DETAIL_TIMES_KEY)).toBeNull();
    });
  });
});

describe('viewedItems - Session storage functions', () => {
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
    it('adds an item ID to session storage', () => {
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
    it('clears all session-viewed items', () => {
      addToSessionViewed(12345);
      addToSessionViewed(67890);
      
      expect(getSessionViewedIds().size).toBe(2);
      
      clearSessionViewed();
      
      expect(getSessionViewedIds().size).toBe(0);
    });
  });
});

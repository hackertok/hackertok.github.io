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
  DETAIL_VIEW_TTL_MEDIUM_HOURS,
  DETAIL_VIEW_TTL_LONG_HOURS,
  DETAIL_DWELL_MEDIUM_MS,
  DETAIL_DWELL_LONG_MS,
  detailTtlHoursForDwell,
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

  describe('detailTtlHoursForDwell', () => {
    it('returns the short (12h) tier for dwell under 3s', () => {
      expect(detailTtlHoursForDwell(0)).toBe(DETAIL_VIEW_TTL_HOURS);
      expect(detailTtlHoursForDwell(DETAIL_DWELL_MEDIUM_MS - 1)).toBe(DETAIL_VIEW_TTL_HOURS);
    });

    it('returns the medium (24h) tier for dwell from 3s up to 60s', () => {
      expect(detailTtlHoursForDwell(DETAIL_DWELL_MEDIUM_MS)).toBe(DETAIL_VIEW_TTL_MEDIUM_HOURS);
      expect(detailTtlHoursForDwell(DETAIL_DWELL_LONG_MS - 1)).toBe(DETAIL_VIEW_TTL_MEDIUM_HOURS);
    });

    it('returns the long (48h) tier for dwell of 60s or more', () => {
      expect(detailTtlHoursForDwell(DETAIL_DWELL_LONG_MS)).toBe(DETAIL_VIEW_TTL_LONG_HOURS);
      expect(detailTtlHoursForDwell(DETAIL_DWELL_LONG_MS * 2)).toBe(DETAIL_VIEW_TTL_LONG_HOURS);
    });
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

    it('treats a stored non-object value (e.g. literal "null") as empty, not a crash', () => {
      // A corrupt/legacy localStorage value must not crash the Object.entries() walk.
      localStorage.setItem(VIEWED_DETAIL_TIMES_KEY, 'null');

      expect(() => getFilteredViewedIds()).not.toThrow();
      expect(getFilteredViewedIds().size).toBe(0);
    });

    it('discards a stored non-object value instead of crashing markViewedWithTime', () => {
      // A bare number would otherwise survive into `times[id] = ...`, which throws
      // in strict mode ("Cannot create property ... on number"). The read path
      // (getFilteredViewedIds) tolerates it, so this guards the write path.
      localStorage.setItem(VIEWED_DETAIL_TIMES_KEY, '123');

      expect(() => markViewedWithTime(999, 'detail')).not.toThrow();
      expect(getFilteredViewedIds().has(999)).toBe(true);
    });

    it('discards a stored array so its indices never leak in as viewed ids', () => {
      // An array passes `typeof === 'object'`, so without the Array.isArray guard
      // Object.entries() would surface its indices ("0", "1") as bogus viewed ids
      // with whatever expiry sat at those slots.
      const future = Date.now() + 10 * 60 * 60 * 1000;
      localStorage.setItem(VIEWED_DETAIL_TIMES_KEY, JSON.stringify([future, future]));

      const ids = getFilteredViewedIds();
      expect(ids.has(0)).toBe(false);
      expect(ids.has(1)).toBe(false);
      expect(ids.size).toBe(0);
    });

    it('drops a non-number expiry value so the id stays markable (no NaN wedge)', () => {
      // A corrupt/foreign string value must not survive into the Math.max merge:
      // it would coerce to NaN, and since NaN !== NaN the skip guard could never
      // fire — the id would never hide and would be re-written on every view.
      localStorage.setItem(VIEWED_DETAIL_TIMES_KEY, JSON.stringify({ '123': 'foo' }));

      // Read path excludes the bad entry (not a crash).
      expect(getFilteredViewedIds().has(123)).toBe(false);

      // A single mark restores a real expiry and hides the id.
      markViewedWithTime(123, 'detail');
      expect(getFilteredViewedIds().has(123)).toBe(true);
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

    it('does not shorten an existing hide window (Math.max merge)', () => {
      // A long detail view (48h) ...
      markViewedWithTime(12345, 'detail', DETAIL_VIEW_TTL_LONG_HOURS);
      const longExpiry = (JSON.parse(localStorage.getItem(VIEWED_DETAIL_TIMES_KEY)!) as Record<string, number>)['12345'];

      // ... then a later short view (12h) must NOT reduce the stored expiry.
      markViewedWithTime(12345, 'detail', DETAIL_VIEW_TTL_HOURS);
      const afterExpiry = (JSON.parse(localStorage.getItem(VIEWED_DETAIL_TIMES_KEY)!) as Record<string, number>)['12345'];

      expect(afterExpiry).toBe(longExpiry);
      expect(getFilteredViewedIds().has(12345)).toBe(true);
    });

    it('extends the hide window when a longer view arrives', () => {
      markViewedWithTime(12345, 'detail', DETAIL_VIEW_TTL_HOURS); // 12h
      const shortExpiry = (JSON.parse(localStorage.getItem(VIEWED_DETAIL_TIMES_KEY)!) as Record<string, number>)['12345'];

      markViewedWithTime(12345, 'detail', DETAIL_VIEW_TTL_LONG_HOURS); // 48h
      const afterExpiry = (JSON.parse(localStorage.getItem(VIEWED_DETAIL_TIMES_KEY)!) as Record<string, number>)['12345'];

      expect(afterExpiry).toBeGreaterThan(shortExpiry);
    });

    it('skips the localStorage write when a re-view cannot extend the window', () => {
      // The merged expiry is identical whether or not the write is skipped, so the
      // skip guard can only be protected by asserting on the write itself. Count
      // writes via a delegating localStorage wrapper (the harness mock exposes
      // setItem as a get-trap closure, so it can't be spied on the prototype).
      markViewedWithTime(12345, 'detail', DETAIL_VIEW_TTL_LONG_HOURS); // 48h

      const detailWrites: string[] = [];
      const real = globalThis.localStorage;
      const counting = new Proxy(real, {
        get(t, p, r) {
          if (p === 'setItem') {
            return (k: string, v: string) => {
              if (k === VIEWED_DETAIL_TIMES_KEY) detailWrites.push(k);
              real.setItem(k, v);
            };
          }
          const passthrough: unknown = Reflect.get(t, p, r);
          return passthrough;
        },
      });
      Object.defineProperty(globalThis, 'localStorage', { value: counting, configurable: true, writable: true });
      try {
        // Shorter re-view (12h < stored 48h) — merge is a no-op, write must be skipped.
        markViewedWithTime(12345, 'detail', DETAIL_VIEW_TTL_HOURS);
        expect(detailWrites).toHaveLength(0);

        // A genuinely longer view still persists exactly one write.
        markViewedWithTime(12345, 'detail', DETAIL_VIEW_TTL_LONG_HOURS * 2);
        expect(detailWrites).toHaveLength(1);
      } finally {
        Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true });
      }
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

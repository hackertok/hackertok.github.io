import { useEffect } from 'react';
import {
  DETAIL_VIEW_TTL_HOURS,
  detailTtlHoursForDwell,
  markViewedWithTime,
} from '../utils/viewedItems';

/**
 * Track how long the active swipe-story panel is actually looked at and persist
 * a dwell-based hide window for it.
 *
 * - On land: writes the 12h floor immediately (preserves the "hide on view"
 *   guarantee and the `< 3s` tier) and adds the item to the session-viewed set.
 * - While active: accumulates only *visible* time (paused on `visibilitychange`
 *   -> hidden) using a monotonic `performance.now()` clock, so backgrounded /
 *   screen-locked time is not counted as dwell.
 * - On leave (swipe to a new id / unmount), tab hidden, or `pagehide`: upgrades
 *   the stored expiry to the tier for the total visible dwell. `markViewedWithTime`
 *   merges with `Math.max`, so repeated finalizes are idempotent and never shorten.
 *
 * `visibilitychange -> hidden` fires before `pagehide`/freeze (Page Lifecycle
 * spec) and nulls the open segment, so a frozen/bfcached interval is not counted;
 * the `pagehide` finalize is a belt-and-suspenders write.
 */
export function useViewDwell(activeId: number | undefined): void {
  useEffect(() => {
    if (activeId == null) return;

    // 12h floor + session, the moment the panel becomes active.
    markViewedWithTime(activeId, 'detail', DETAIL_VIEW_TTL_HOURS);

    let accumulated = 0;
    let segmentStart: number | null =
      document.visibilityState === 'visible' ? performance.now() : null;

    const dwellMs = () =>
      accumulated + (segmentStart != null ? performance.now() - segmentStart : 0);

    const finalize = () => {
      const ttlHours = detailTtlHoursForDwell(dwellMs());
      // Floor already written on land; only persist when dwell upgrades the tier.
      if (ttlHours > DETAIL_VIEW_TTL_HOURS) {
        markViewedWithTime(activeId, 'detail', ttlHours);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (segmentStart != null) {
          accumulated += performance.now() - segmentStart;
          segmentStart = null;
        }
        finalize();
      } else {
        segmentStart = performance.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', finalize);

    return () => {
      finalize();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', finalize);
    };
  }, [activeId]);
}

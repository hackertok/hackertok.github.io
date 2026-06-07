import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewDwell } from './useViewDwell';
import {
  clearViewed,
  clearViewedTimes,
  clearSessionViewed,
  getSessionViewedIds,
  VIEWED_DETAIL_TIMES_KEY,
  DETAIL_VIEW_TTL_HOURS,
  DETAIL_VIEW_TTL_MEDIUM_HOURS,
  DETAIL_VIEW_TTL_LONG_HOURS,
  DETAIL_DWELL_MEDIUM_MS,
  DETAIL_DWELL_LONG_MS,
} from '../utils/viewedItems';

const HOUR_MS = 3_600_000;
const FIXED_NOW = 1_700_000_000_000;
const ID = 12345;

// `document.visibilityState` is read-only; back it with a mutable variable so
// tests can toggle it and dispatch the matching `visibilitychange` event.
let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibility,
});

// Mutable monotonic clock for performance.now() (drives dwell measurement).
let perf = 0;

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function detailExpiry(id: number): number | undefined {
  const raw = localStorage.getItem(VIEWED_DETAIL_TIMES_KEY);
  return raw ? (JSON.parse(raw) as Record<string, number>)[String(id)] : undefined;
}

describe('useViewDwell', () => {
  beforeEach(() => {
    clearViewed();
    clearViewedTimes();
    clearSessionViewed();
    visibility = 'visible';
    perf = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => perf);
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the 12h floor and session entry on land', () => {
    renderHook(() => useViewDwell(ID));

    expect(detailExpiry(ID)).toBe(FIXED_NOW + DETAIL_VIEW_TTL_HOURS * HOUR_MS);
    expect(getSessionViewedIds().has(ID)).toBe(true);
  });

  it('does nothing when there is no active id', () => {
    renderHook(() => useViewDwell(undefined));

    expect(detailExpiry(ID)).toBeUndefined();
    expect(localStorage.getItem(VIEWED_DETAIL_TIMES_KEY)).toBeNull();
  });

  it('keeps the 12h tier for a dwell under 3s', () => {
    const { unmount } = renderHook(() => useViewDwell(ID));

    perf = DETAIL_DWELL_MEDIUM_MS - 500; // 2.5s visible
    unmount();

    expect(detailExpiry(ID)).toBe(FIXED_NOW + DETAIL_VIEW_TTL_HOURS * HOUR_MS);
  });

  it('upgrades to the 24h tier for a 3-60s dwell', () => {
    const { unmount } = renderHook(() => useViewDwell(ID));

    perf = DETAIL_DWELL_MEDIUM_MS; // exactly 3s visible
    unmount();

    expect(detailExpiry(ID)).toBe(FIXED_NOW + DETAIL_VIEW_TTL_MEDIUM_HOURS * HOUR_MS);
  });

  it('upgrades to the 48h tier for a dwell of 60s or more', () => {
    const { unmount } = renderHook(() => useViewDwell(ID));

    perf = DETAIL_DWELL_LONG_MS; // 60s visible
    unmount();

    expect(detailExpiry(ID)).toBe(FIXED_NOW + DETAIL_VIEW_TTL_LONG_HOURS * HOUR_MS);
  });

  it('excludes time while the tab is hidden from the dwell total', () => {
    const { unmount } = renderHook(() => useViewDwell(ID));

    // 2s visible, then hidden for a long stretch of wall-clock time.
    perf = 2_000;
    setVisibility('hidden');

    perf = 2_000 + 5 * 60_000; // 5 minutes pass while hidden
    setVisibility('visible');

    // Only 1 more second of visible time before leaving.
    perf += 1_000;
    setVisibility('hidden');
    unmount();

    // 2s + 1s = 3s of *visible* dwell -> 24h tier, NOT the 48h that raw
    // wall-clock (>5min) would have produced.
    expect(detailExpiry(ID)).toBe(FIXED_NOW + DETAIL_VIEW_TTL_MEDIUM_HOURS * HOUR_MS);
  });

  it('finalizes on visibilitychange:hidden even without unmount', () => {
    renderHook(() => useViewDwell(ID));

    perf = DETAIL_DWELL_LONG_MS;
    setVisibility('hidden');

    expect(detailExpiry(ID)).toBe(FIXED_NOW + DETAIL_VIEW_TTL_LONG_HOURS * HOUR_MS);
  });

  it('finalizes the previous story and floors the next when the active id changes', () => {
    // The common production path: the user swipes from one story to the next,
    // which re-keys the effect (cleanup-finalizes the old id, re-runs for the new).
    const NEXT = 67890;
    const { rerender } = renderHook(({ id }) => useViewDwell(id), {
      initialProps: { id: ID },
    });

    perf = DETAIL_DWELL_MEDIUM_MS; // 3s of visible dwell on the first story
    rerender({ id: NEXT });

    // Leaving the first story upgrades it to the 24h tier...
    expect(detailExpiry(ID)).toBe(FIXED_NOW + DETAIL_VIEW_TTL_MEDIUM_HOURS * HOUR_MS);
    // ...and landing on the next writes its 12h floor + session entry immediately.
    expect(detailExpiry(NEXT)).toBe(FIXED_NOW + DETAIL_VIEW_TTL_HOURS * HOUR_MS);
    expect(getSessionViewedIds().has(NEXT)).toBe(true);
  });

  it('finalizes on pagehide even without unmount', () => {
    renderHook(() => useViewDwell(ID));

    perf = DETAIL_DWELL_LONG_MS; // 60s visible
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(detailExpiry(ID)).toBe(FIXED_NOW + DETAIL_VIEW_TTL_LONG_HOURS * HOUR_MS);
  });
});

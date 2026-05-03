import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useStaggerCascadeSlots } from './useStaggerCascadeSlots';

describe('useStaggerCascadeSlots', () => {
  // Cold-load: until the first non-loading render with cards, every
  // index falls into the initial-cascade slot (PageStage owns the
  // animation via `.stagger-fade`).
  it('routes every card to stageIdx during the cold load', () => {
    const { result } = renderHook(() =>
      useStaggerCascadeSlots(true, 0),
    );

    expect(result.current(0)).toEqual({ stageIdx: 0 });
    expect(result.current(5)).toEqual({ stageIdx: 5 });
  });

  it('keeps cards in the initial batch on stageIdx after the boundary latches', () => {
    const { result, rerender } = renderHook(
      ({ loading, count }) => useStaggerCascadeSlots(loading, count),
      { initialProps: { loading: true, count: 0 } },
    );

    rerender({ loading: false, count: 20 });

    expect(result.current(0)).toEqual({ stageIdx: 0 });
    expect(result.current(19)).toEqual({ stageIdx: 19 });
  });

  // Critical regression: the previous boundary-relative formulation
  // made batch 2 start at `appendIdx 20` (575ms+ delay before the
  // first card landed — the "spinner clears, then a pause" symptom).
  // Per-batch reset means each new fetch starts at 0ms again.
  it('resets appendIdx to 0 on every infinite-scroll batch', () => {
    const { result, rerender } = renderHook(
      ({ loading, count }) => useStaggerCascadeSlots(loading, count),
      { initialProps: { loading: true, count: 0 } },
    );

    // Cold load resolves with 20 cards → boundary latches at 20.
    rerender({ loading: false, count: 20 });
    expect(result.current(19)).toEqual({ stageIdx: 19 });

    // First append: user scrolls, fetch starts (loading flips true)
    // → batchStart captures 20. Fetch resolves with 20 more cards.
    rerender({ loading: true, count: 20 });
    rerender({ loading: false, count: 40 });
    expect(result.current(20)).toEqual({ appendIdx: 0 });
    expect(result.current(39)).toEqual({ appendIdx: 19 });

    // Second append: batchStart MUST advance to 40 (not stay at 20),
    // otherwise card 40 would be slot 20 in the cascade and inherit
    // the cap delay. This is the regression check.
    rerender({ loading: true, count: 40 });
    rerender({ loading: false, count: 60 });
    expect(result.current(40)).toEqual({ appendIdx: 0 });
    expect(result.current(59)).toEqual({ appendIdx: 19 });

    // Third append: same expectation — no accumulation.
    rerender({ loading: true, count: 60 });
    rerender({ loading: false, count: 80 });
    expect(result.current(60)).toEqual({ appendIdx: 0 });
  });

  // Cards in past append batches drop both slots — the parent's
  // re-pass is a no-op because StoryCard snapshots its slot at
  // mount. Returning `{}` here is defensive: passing nothing keeps
  // CSS classes off the wrapper for any future caller that doesn't
  // snapshot.
  it('returns no slot for cards in past append batches', () => {
    const { result, rerender } = renderHook(
      ({ loading, count }) => useStaggerCascadeSlots(loading, count),
      { initialProps: { loading: true, count: 0 } },
    );

    rerender({ loading: false, count: 20 });
    rerender({ loading: true, count: 20 });
    rerender({ loading: false, count: 40 });
    rerender({ loading: true, count: 40 });

    // batchStart is now 40 (third fetch starting). Card 20 is in the
    // PREVIOUS append batch, so it gets neither stageIdx (index >=
    // boundary) nor appendIdx (index < batchStart).
    expect(result.current(20)).toEqual({});
    expect(result.current(39)).toEqual({});
  });

  // Empty initial fetches (e.g. unknown user, domain with no
  // submissions) must not latch the boundary at 0 — that would route
  // every future card through `appendIdx` and skip the cold-load
  // cascade entirely on the retry/refresh that brings cards in.
  it('does not latch the boundary on an empty initial result', () => {
    const { result, rerender } = renderHook(
      ({ loading, count }) => useStaggerCascadeSlots(loading, count),
      { initialProps: { loading: true, count: 0 } },
    );

    rerender({ loading: false, count: 0 });
    rerender({ loading: true, count: 0 });
    rerender({ loading: false, count: 8 });

    // Boundary latched at 8 on the second resolve, NOT 0 on the
    // first.
    expect(result.current(0)).toEqual({ stageIdx: 0 });
    expect(result.current(7)).toEqual({ stageIdx: 7 });
  });

  // Cache-hit / back-nav: useInfiniteStories returns cached entries
  // with loading=false from the very first render. The boundary
  // must capture on that first commit so subsequent appends route
  // through .append-fade.
  it('captures the boundary on cache-hit (loading=false from first render)', () => {
    const { result, rerender } = renderHook(
      ({ loading, count }) => useStaggerCascadeSlots(loading, count),
      { initialProps: { loading: false, count: 30 } },
    );

    expect(result.current(0)).toEqual({ stageIdx: 0 });
    expect(result.current(29)).toEqual({ stageIdx: 29 });

    rerender({ loading: true, count: 30 });
    rerender({ loading: false, count: 50 });
    expect(result.current(30)).toEqual({ appendIdx: 0 });
    expect(result.current(49)).toEqual({ appendIdx: 19 });
  });

  describe('resetKey', () => {
    // Without resetKey, navigating from /top (with appended batches)
    // to a cached /best would inherit /top's boundary AND batchStart,
    // routing the first ~20 best cards through `stageIdx` (snap, no
    // animation in 'done' state) and the rest through `appendIdx`
    // with the wrong baseline. The reset collapses everything so the
    // new context starts fresh.
    it('resets boundary and batchStart when resetKey changes', () => {
      const { result, rerender } = renderHook(
        ({ loading, count, key }: { loading: boolean; count: number; key: string }) =>
          useStaggerCascadeSlots(loading, count, key),
        { initialProps: { loading: true, count: 0, key: 'top' } },
      );

      // Cold load + first append on /top.
      rerender({ loading: false, count: 20, key: 'top' });
      rerender({ loading: true, count: 20, key: 'top' });
      rerender({ loading: false, count: 40, key: 'top' });
      expect(result.current(20)).toEqual({ appendIdx: 0 });

      // Switch to /best — same hook instance, new context.
      rerender({ loading: false, count: 30, key: 'best' });
      // Boundary re-captures on the post-reset commit at the new
      // count (30), so the first 30 best cards get stageIdx.
      expect(result.current(0)).toEqual({ stageIdx: 0 });
      expect(result.current(29)).toEqual({ stageIdx: 29 });

      // Best then appends cleanly with batch-relative appendIdx.
      rerender({ loading: true, count: 30, key: 'best' });
      rerender({ loading: false, count: 50, key: 'best' });
      expect(result.current(30)).toEqual({ appendIdx: 0 });
      expect(result.current(49)).toEqual({ appendIdx: 19 });
    });

    it('does NOT reset when resetKey stays the same across re-renders', () => {
      // Re-renders with stable resetKey are the common case; the
      // reset path must not fire on every render or the cascade
      // would never advance.
      const { result, rerender } = renderHook(
        ({ loading, count, key }: { loading: boolean; count: number; key: string }) =>
          useStaggerCascadeSlots(loading, count, key),
        { initialProps: { loading: true, count: 0, key: 'top' } },
      );

      rerender({ loading: false, count: 20, key: 'top' });
      rerender({ loading: false, count: 20, key: 'top' });
      rerender({ loading: false, count: 20, key: 'top' });

      expect(result.current(0)).toEqual({ stageIdx: 0 });
      expect(result.current(19)).toEqual({ stageIdx: 19 });
    });
  });
});

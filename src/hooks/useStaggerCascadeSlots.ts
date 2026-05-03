import { useCallback, useEffect, useRef, useState } from 'react';

export interface CascadeSlot {
  /**
   * Slot in the cold-load cascade owned by `PageStage`. Triggers the
   * scoped `.page-stage.play-real .stagger-fade` rule, which only
   * matches during `'transitioning'`, so cards stay quiet on cache
   * hits where PageStage lands directly in `'done'`.
   */
  stageIdx?: number;
  /**
   * Slot in the current infinite-scroll append batch. Triggers the
   * unscoped `.append-fade` rule on mount so each batch picks up a
   * fresh decay cascade from 0ms.
   */
  appendIdx?: number;
}

/**
 * Splits each card index into the appropriate cascade slot
 * (`stageIdx` for the initial PageStage cascade, `appendIdx` for
 * subsequent infinite-scroll appends).
 *
 * `batchStart` snapshots `count` at the start of each append fetch
 * (`loading` false → true) so `appendIdx = index - batchStart` resets
 * to 0ms per batch. Without this reset the second batch would start
 * at the 600ms cap and every later batch would pile on top of it,
 * reading as "spinner clears, then a noticeable pause, then cards land".
 *
 * `resetKey` collapses internal state on context change (feed type,
 * domain, username switch) so the new feed gets its own cold-load
 * cascade rather than inheriting the previous one's boundary. MUST
 * be a primitive or referentially stable value — passing a fresh
 * object/array literal each render (e.g. `{type, sort}`) would
 * trigger reset every render and prevent the cascade from ever
 * advancing.
 *
 * `StoryCard` snapshots the slot at mount, so a later `getSlot` call
 * returning a different value (because `batchStart` advanced for the
 * next fetch) is intentionally a no-op for already-mounted cards.
 */
export function useStaggerCascadeSlots(
  loading: boolean,
  count: number,
  resetKey?: unknown,
): (index: number) => CascadeSlot {
  const [initialBoundary, setInitialBoundary] = useState<number | null>(null);
  const [batchStart, setBatchStart] = useState(0);
  const wasLoadingRef = useRef(loading);
  const resetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      setInitialBoundary(null);
      setBatchStart(0);
      // Re-baseline the loading edge so the next false→true on the
      // new context captures batchStart cleanly.
      wasLoadingRef.current = loading;
      return;
    }

    if (initialBoundary === null && !loading && count > 0) {
      setInitialBoundary(count);
    }

    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = loading;
    if (!wasLoading && loading) {
      setBatchStart(count);
    }
  }, [loading, count, initialBoundary, resetKey]);

  return useCallback(
    (index: number): CascadeSlot => {
      // Boundary is null on the very first render with cards (effect
      // hasn't committed yet) — treat the whole array as initial so
      // PageStage owns the cascade.
      if (initialBoundary === null || index < initialBoundary) {
        return { stageIdx: index };
      }
      // Past-batch cards drop both slots — already mounted and
      // snapshotted in StoryCard, so the parent re-pass is a no-op.
      if (index < batchStart) {
        return {};
      }
      return { appendIdx: index - batchStart };
    },
    [initialBoundary, batchStart],
  );
}

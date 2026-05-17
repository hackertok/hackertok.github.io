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
 * Splits each card index into `stageIdx` (initial PageStage cascade)
 * or `appendIdx` (per-batch infinite-scroll cascade).
 *
 * `batchStart` resets to 0 per batch so appended cards don't inherit
 * the prior batch's cap. `resetKey` collapses state on context change
 * (MUST be a primitive). `StoryCard` snapshots its slot at mount.
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

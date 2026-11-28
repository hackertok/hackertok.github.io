import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFirebaseItem, fetchHiddenCommentIds } from '../api/hn';
import { errorMessage, isAbortError } from '../utils/errors';

const NO_IDS: ReadonlySet<number> = new Set();

interface UseSiblingCommentsResult {
  siblingIds: number[];
  /**
   * The flagged and deleted siblings with no replies, which the thread leaves
   * out. Every sibling is read for this, so it fills in after `siblingIds`.
   */
  hiddenIds: ReadonlySet<number>;
  currentIndex: number;
  loading: boolean;
  error: string | null;
  retry: () => Promise<void>;
}

export function useSiblingComments(commentId: number | string): UseSiblingCommentsResult {
  const [siblingIds, setSiblingIds] = useState<number[]>([Number(commentId)]);
  const [hiddenIds, setHiddenIds] = useState(NO_IDS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const numericId = Number(commentId);

    // Reset to show at least this comment while loading
    setSiblingIds([numericId]);
    setHiddenIds(NO_IDS);
    setCurrentIndex(0);
    setError(null);
    setLoading(true);

    try {
      const item = await fetchFirebaseItem(numericId, signal);
      if (signal.aborted) return;

      // Every comment has a parent, even a deleted one, so this is an item that
      // isn't a comment (a story, job, poll or poll option); show just this one.
      if (item.parent == null) {
        setSiblingIds([numericId]);
        setCurrentIndex(0);
        setLoading(false);
        return;
      }

      // parent.kids[] holds sibling IDs in HN ranking order.
      const parent = await fetchFirebaseItem(item.parent, signal);
      if (signal.aborted) return;

      const kids = parent?.kids;
      if (kids && kids.length > 0) {
        setSiblingIds(kids);
        const idx = kids.indexOf(numericId);
        setCurrentIndex(idx >= 0 ? idx : 0);
      } else {
        setSiblingIds([numericId]);
        setCurrentIndex(0);
      }
      setLoading(false);

      if (kids && kids.length > 1) {
        void fetchHiddenCommentIds(kids, numericId, signal).then(
          hidden => {
            if (!signal.aborted) setHiddenIds(hidden);
          },
          () => { /* none are skipped */ },
        );
      }
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return;
      setError(errorMessage(err));
      setLoading(false);
      throw err;
    }
  }, [commentId]);

  const retry = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    await load(controller.signal);
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    load(controller.signal).catch(() => { /* error state set internally */ });
    return () => {
      controllerRef.current?.abort();
    };
  }, [load]);

  return { siblingIds, hiddenIds, currentIndex, loading, error, retry };
}

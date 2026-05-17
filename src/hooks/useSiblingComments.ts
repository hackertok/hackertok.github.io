import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFirebaseItem } from '../api/hn';

interface UseSiblingCommentsResult {
  siblingIds: number[];
  currentIndex: number;
  loading: boolean;
  error: string | null;
  retry: () => Promise<void>;
}

export function useSiblingComments(commentId: number | string): UseSiblingCommentsResult {
  const [siblingIds, setSiblingIds] = useState<number[]>([Number(commentId)]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const numericId = Number(commentId);

    // Reset to show at least this comment while loading
    setSiblingIds([numericId]);
    setCurrentIndex(0);
    setError(null);
    setLoading(true);

    try {
      const item = await fetchFirebaseItem(numericId, signal);
      if (signal.aborted) return;

      // No parent → top-level comment or deleted; show just this one.
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
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      setError(err instanceof Error ? err.message : String(err));
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

  return { siblingIds, currentIndex, loading, error, retry };
}

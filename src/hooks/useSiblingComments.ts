import { useState, useEffect, useCallback } from 'react';
import { fetchFirebaseItem } from '../api/hn';

interface UseSiblingCommentsResult {
  siblingIds: number[];
  currentIndex: number;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useSiblingComments(commentId: number | string): UseSiblingCommentsResult {
  const [siblingIds, setSiblingIds] = useState<number[]>([Number(commentId)]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount(c => c + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const numericId = Number(commentId);

    // Reset to show at least this comment while loading
    setSiblingIds([numericId]);
    setCurrentIndex(0);
    setError(null);
    setLoading(true);

    async function load() {
      try {
        // 1. Fetch comment to get parent ID
        const item = await fetchFirebaseItem(numericId, controller.signal);
        if (controller.signal.aborted) return;

        // If no parent, show single comment (top-level or deleted)
        if (item.parent == null) {
          setSiblingIds([numericId]);
          setCurrentIndex(0);
          setLoading(false);
          return;
        }

        // 2. Fetch parent to get kids[] (sibling IDs in HN ranking order)
        const parent = await fetchFirebaseItem(item.parent, controller.signal);
        if (controller.signal.aborted) return;

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
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [commentId, retryCount]);

  return { siblingIds, currentIndex, loading, error, retry };
}

import { useState, useEffect, useCallback } from 'react';
import { fetchAlgoliaItem, fetchFirebaseItem, normalizeAlgoliaItemChildren } from '../api/hn';
import type { Comment } from '../types';

interface CommentData {
  id: number;
  author: string;
  text: string;
  createdAt: number;
  parentId: number | null;
}

interface UseCommentDetailResult {
  comment: CommentData | null;
  replies: Comment[];
  itemId: number | null;
  itemTitle: string | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

interface InitialData {
  author: string;
  text: string;
  createdAt: number;
  parentId?: number;
}

export function useCommentDetail(
  commentId: number | string,
  initialData?: InitialData,
): UseCommentDetailResult {
  const [comment, setComment] = useState<CommentData | null>(
    initialData
      ? { id: Number(commentId), author: initialData.author, text: initialData.text, createdAt: initialData.createdAt, parentId: initialData.parentId ?? null }
      : null,
  );
  const [replies, setReplies] = useState<Comment[]>([]);
  const [itemId, setItemId] = useState<number | null>(null);
  const [itemTitle, setItemTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount(c => c + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setError(null);
      setLoading(true);

      try {
        // Single request: comment + full reply tree + story_id
        const item = await fetchAlgoliaItem(commentId, controller.signal);
        if (controller.signal.aborted) return;

        setComment({
          id: item.id,
          author: item.author ?? '',
          text: item.text ?? '',
          createdAt: item.created_at_i * 1000,
          parentId: item.parent_id,
        });
        setItemId(item.story_id ?? null);
        setReplies(normalizeAlgoliaItemChildren(item.children ?? []));
        setLoading(false);

        // Fetch parent item title in background (non-blocking)
        if (item.story_id) {
          try {
            const parentItem = await fetchFirebaseItem(item.story_id, controller.signal);
            if (!controller.signal.aborted && parentItem?.title) {
              setItemTitle(parentItem.title);
            }
          } catch {
            // Degrade gracefully — "on:" link still works with itemId
          }
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [commentId, retryCount]);

  return { comment, replies, itemId, itemTitle, loading, error, retry };
}

import { useState, useEffect, useCallback, useRef } from 'react';
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
  /**
   * Author handle of the parent story (not the comment's author).
   * Resolved asynchronously alongside `itemTitle`; `null` until that
   * fetch completes. Consumers MUST guard with
   * `isKnownAuthor(itemAuthor)` before using it for OP detection.
   */
  itemAuthor: string | null;
  loading: boolean;
  error: string | null;
  retry: () => Promise<void>;
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
  const [itemAuthor, setItemAuthor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    setError(null);
    setLoading(true);

    try {
      const item = await fetchAlgoliaItem(commentId, signal);
      if (signal.aborted) return;

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

      // Fetch parent title + author in background (non-blocking).
      // The author drives OP detection; landing ~100-300ms after the
      // comment renders means the badge pops in late, which is the
      // accepted trade-off vs delaying the focal render.
      if (item.story_id) {
        try {
          const parentItem = await fetchFirebaseItem(item.story_id, signal);
          if (!signal.aborted && parentItem) {
            if (parentItem.title) setItemTitle(parentItem.title);
            if (parentItem.by) setItemAuthor(parentItem.by);
          }
        } catch {
          // Degrade gracefully — title link still works with itemId
          // alone; OP badge stays off (consumers guard with
          // `isKnownAuthor(itemAuthor)`).
        }
      }
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

  // Initial load + re-fetch when commentId changes.
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    load(controller.signal).catch(() => { /* error state set internally */ });
    return () => {
      controllerRef.current?.abort();
    };
  }, [load]);

  return { comment, replies, itemId, itemTitle, itemAuthor, loading, error, retry };
}

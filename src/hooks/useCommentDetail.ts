import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchCommentItem, fetchCommentReplies, fetchFirebaseItem, normalizeAlgoliaItemChildren } from '../api/hn';
import type { Comment } from '../types';

function countComments(comments: Comment[]): number {
  return comments.reduce((count, comment) => count + 1 + countComments(comment.children), 0);
}

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
  /**
   * True while flagged and deleted replies, which Algolia's item tree
   * leaves out, are being looked up. `replies` can still grow until then.
   */
  moreRepliesLoading: boolean;
  itemId: number | null;
  itemTitle: string | null;
  /** True while the parent story's title and author are being fetched. */
  itemTitleLoading: boolean;
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
  const [moreRepliesLoading, setMoreRepliesLoading] = useState(false);
  const [itemId, setItemId] = useState<number | null>(null);
  const [itemTitle, setItemTitle] = useState<string | null>(null);
  const [itemTitleLoading, setItemTitleLoading] = useState(false);
  const [itemAuthor, setItemAuthor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    setError(null);
    setLoading(true);
    setMoreRepliesLoading(false);

    try {
      const item = await fetchCommentItem(commentId, signal);
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
      setItemTitleLoading(!!item.story_id);
      setMoreRepliesLoading(!!item.story_id);
      setLoading(false);

      // Algolia's item tree leaves out flagged and deleted replies along with
      // the replies under them. Those fill in once the story's comments are read.
      if (item.story_id) {
        void fetchCommentReplies(item, signal).then(
          all => {
            if (signal.aborted) return;
            setReplies(shown => (countComments(all) > countComments(shown) ? all : shown));
            setMoreRepliesLoading(false);
          },
          () => {
            // Algolia's replies stay.
            if (!signal.aborted) setMoreRepliesLoading(false);
          },
        );
      }

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
        } finally {
          if (!signal.aborted) setItemTitleLoading(false);
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

  return { comment, replies, moreRepliesLoading, itemId, itemTitle, itemTitleLoading, itemAuthor, loading, error, retry };
}

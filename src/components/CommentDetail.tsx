import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCommentDetail } from '../hooks/useCommentDetail';
import { CommentTree, CommentSkeletonTree } from '../components';
import { formatTimeAgo } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

interface CommentDetailProps {
  commentId: number | string;
  initialData?: {
    author: string;
    text: string;
    createdAt: number;
    parentId?: number;
  };
}

export function CommentDetail({ commentId, initialData }: CommentDetailProps) {
  const { comment, replies, itemId, itemTitle, loading, error } = useCommentDetail(commentId, initialData);

  useDocumentTitle(comment?.author ? `Comment by ${comment.author}` : undefined);

  const commentText = comment?.text;
  const sanitizedText = useMemo(
    () => commentText ? sanitizeHtml(commentText) : '',
    [commentText],
  );

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-8 text-center">
        <p className="text-red-500 dark:text-red-400 mb-4">Failed to load comment: {error}</p>
        <Link to="/" className="text-hn-orange hover:underline">Back to feed</Link>
      </div>
    );
  }

  if (!comment && loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-48 mb-2" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-64 mb-4" />
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-full mb-2" />
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-3/4 mb-6" />
          <CommentSkeletonTree count={6} />
        </div>
      </div>
    );
  }

  if (!comment) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      <article className="mb-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        {/* Author + time */}
        <div className="text-[13px] text-gray-600 dark:text-gray-400 mb-1.5">
          <span className="font-medium text-gray-700 dark:text-gray-300">{comment.author}</span>
          <span className="mx-1.5">·</span>
          <span>{formatTimeAgo(comment.createdAt)}</span>
        </div>

        {/* Navigation: parent | on: Item Title */}
        <div className="text-[13px] text-gray-600 dark:text-gray-400 mb-3">
          {comment.parentId != null && (
            <Link
              to={`/item/${comment.parentId}`}
              className="text-hn-orange hover:underline"
            >
              parent
            </Link>
          )}
          {itemId != null ? (
            <>
              {comment.parentId != null && <span className="mx-1.5">|</span>}
              <span>on: </span>
              <Link
                to={`/item/${itemId}`}
                className="text-hn-orange hover:underline"
              >
                {itemTitle ?? `item ${itemId}`}
              </Link>
            </>
          ) : loading && (
            <>
              {comment.parentId != null && <span className="mx-1.5">|</span>}
              <span className="inline-block h-3 w-48 bg-gray-200 dark:bg-gray-800 rounded animate-pulse align-middle" />
            </>
          )}
        </div>

        {/* Comment text */}
        {sanitizedText && (
          <div
            className="comment-content text-gray-800 dark:text-gray-200 text-[15px] leading-relaxed"
            dangerouslySetInnerHTML={{ __html: sanitizedText }}
          />
        )}
      </article>

      {/* Replies */}
      <section>
        {loading ? (
          <CommentSkeletonTree count={6} />
        ) : replies.length > 0 ? (
          <>
            <div className="text-[13px] text-gray-500 dark:text-gray-500 mb-3">
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </div>
            <CommentTree comments={replies} />
          </>
        ) : (
          <p className="text-gray-500 dark:text-gray-500 text-sm py-4">No replies yet.</p>
        )}
      </section>
    </div>
  );
}

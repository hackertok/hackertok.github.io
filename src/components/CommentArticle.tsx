import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CommentTree } from './Comment';
import { CommentSkeletonTree } from './CommentSkeleton';
import { StateView } from './StateView';
import { formatTimeAgo, formatAbsoluteTime, safeISOString } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import type { Comment } from '../types';

interface CommentArticleProps {
  comment: {
    author: string;
    text: string;
    createdAt: number;
    parentId: number | null;
  };
  replies: Comment[];
  itemId: number | null;
  itemTitle: string | null;
  loading: boolean;
  articleClassName?: string;
}

export function CommentArticle({
  comment,
  replies,
  itemId,
  itemTitle,
  loading,
  articleClassName = 'mb-4',
}: CommentArticleProps) {
  const sanitizedText = useMemo(
    () => comment.text ? sanitizeHtml(comment.text) : '',
    [comment.text],
  );

  return (
    <>
      <article className={`${articleClassName} pb-4 border-b border-border`}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-0.5">
          <span className="text-accent/80 text-base leading-none">›</span>
          <Link
            to={`/user/${comment.author}`}
            className="font-medium text-foreground hover:text-accent transition-colors"
          >
            {comment.author}
          </Link>
          <span className="text-muted-foreground">·</span>
          <time dateTime={safeISOString(comment.createdAt)} title={formatAbsoluteTime(comment.createdAt)}>{formatTimeAgo(comment.createdAt)}</time>
        </div>

        <div className="text-sm text-muted-foreground mb-3">
          {comment.parentId != null && (
            <Link
              to={`/item/${comment.parentId}`}
              state={{ isComment: itemId != null && comment.parentId !== itemId }}
              className="hover:text-accent transition-colors"
            >
              parent
            </Link>
          )}
          {itemId != null ? (
            <>
              {comment.parentId != null && <span className="mx-1.5">|</span>}
              <span>on: </span>
              {itemTitle ? (
                <Link
                  to={`/item/${itemId}`}
                  state={{ isComment: false }}
                  className="hover:text-accent transition-colors"
                >
                  {itemTitle}
                </Link>
              ) : (
                <span className="inline-block h-3 w-48 bg-skeleton rounded animate-pulse align-middle" />
              )}
            </>
          ) : loading && (
            <>
              {comment.parentId != null && <span className="mx-1.5">|</span>}
              <span className="inline-block h-3 w-48 bg-skeleton rounded animate-pulse align-middle" />
            </>
          )}
        </div>

        {sanitizedText && (
          <div
            className="comment-content text-foreground text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: sanitizedText }}
          />
        )}
      </article>

      <section>
        {loading ? (
          <CommentSkeletonTree count={6} />
        ) : replies.length > 0 ? (
          <CommentTree comments={replies} />
        ) : (
          <StateView variant="empty" compact title="No replies yet." />
        )}
      </section>
    </>
  );
}

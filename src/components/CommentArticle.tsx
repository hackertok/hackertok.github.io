import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Clock, CornerUpLeft, MessagesSquare } from 'lucide-react';
import { CommentTree } from './Comment';
import { CommentSkeletonTree } from './CommentSkeleton';
import { StateView } from './StateView';
import { AuthorByline } from './AuthorByline';
import { RelativeTime } from './RelativeTime';
import { sanitizeHtml } from '../utils/sanitize';
import { isKnownAuthor } from '../api/hn';
import { metaItemClass, metaPillClass } from '../lib/classes';
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
  /**
   * Author handle of the surrounding story. When it matches
   * `comment.author`, the focal byline picks up an OP badge and
   * forwards through the reply tree. Guarded by `isKnownAuthor` so
   * unknown / empty story authors never OP-decorate.
   */
  storyAuthor?: string;
}

export function CommentArticle({
  comment,
  replies,
  itemId,
  itemTitle,
  loading,
  articleClassName = 'mb-4',
  storyAuthor = '',
}: CommentArticleProps) {
  const isOp = isKnownAuthor(storyAuthor) && comment.author === storyAuthor;
  const sanitizedText = useMemo(
    () => comment.text ? sanitizeHtml(comment.text) : '',
    [comment.text],
  );

  return (
    <>
      <article className={`${articleClassName} pb-4 border-b border-border`}>
        {/* Single meta row [author, time, parent, thread-title]. Icons
            are aria-hidden so accessible names stay exactly the visible
            label — preserves `getByRole('link', { name: ... })`
            assertions. Nested replies under this article render via
            CommentTree and keep the compact `›` byline. */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-muted-foreground mb-3">
          <AuthorByline author={comment.author} isOp={isOp} />

          <span className={metaItemClass}>
            <Clock aria-hidden className="size-3.5" />
            <RelativeTime timestamp={comment.createdAt} />
          </span>

          {comment.parentId != null && (
            <Link
              to={`/item/${comment.parentId}`}
              state={{ isComment: itemId != null && comment.parentId !== itemId }}
              className={metaPillClass}
            >
              <CornerUpLeft aria-hidden className="size-3.5" />
              parent
            </Link>
          )}

          {(itemId != null || loading) && (
            itemId != null && itemTitle ? (
              // `min-w-0 max-w-full` lets the link shrink below its
              // intrinsic content width when it wraps onto its own row
              // (the meta row is `flex-wrap`), so the inner `truncate`
              // can ellipsize instead of spilling. Icon gets `shrink-0`
              // so it always stays visible.
              <Link
                to={`/item/${itemId}`}
                state={{ isComment: false }}
                className={`${metaPillClass} min-w-0 max-w-full`}
              >
                <MessagesSquare aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{itemTitle}</span>
              </Link>
            ) : itemId != null && !loading ? (
              // Resolved-but-titleless fallback (parent fetch errored
              // or returned without a title). Show a generic "story"
              // link so the user still has a path back to the root
              // instead of sitting on the skeleton forever.
              <Link
                to={`/item/${itemId}`}
                state={{ isComment: false }}
                className={metaPillClass}
              >
                <MessagesSquare aria-hidden className="size-3.5 shrink-0" />
                story
              </Link>
            ) : (
              <span className={metaItemClass}>
                <MessagesSquare aria-hidden className="size-3.5 shrink-0" />
                <span className="inline-block h-3 w-48 bg-skeleton rounded animate-pulse align-middle" />
              </span>
            )
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
          // Bridges CommentDetail's initialData progressive-rendering
          // gap: when `comment` is seeded, PageStage skips its skeleton
          // and `replies=[]` would otherwise flash "No replies yet."
          // for the ~100-500ms before the algolia fetch resolves. On
          // cold load PageStage's overlay covers this branch.
          <CommentSkeletonTree count={6} />
        ) : replies.length > 0 ? (
          <CommentTree comments={replies} storyAuthor={storyAuthor} />
        ) : (
          <StateView variant="empty" compact title="No replies yet." />
        )}
      </section>
    </>
  );
}

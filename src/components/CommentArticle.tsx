import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Clock, CornerUpLeft, MessagesSquare } from 'lucide-react';
import { CommentTree } from './Comment';
import { CommentSkeletonTree } from './CommentSkeleton';
import { StateView } from './StateView';
import { AuthorByline } from './AuthorByline';
import { RelativeTime } from './RelativeTime';
import { sanitizeHtml } from '../utils/sanitize';
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
        {/* Single meta row — author + time + (parent + thread title), all on
            one flex line with leading icons and gap-only separation. Matches
            the modernized meta-row pattern in StoryCard / ItemArticle /
            UserProfile, including the byline color: author inherits the
            muted-foreground baseline like every other meta item, with
            `font-medium` as the axe-compliant non-color signal (weight
            delta vs surrounding font-normal). The pill-on-hover backdrop
            handles all the "I'm the comment owner / I'm clickable"
            affordance work, so the static brighter color is no longer
            needed. See StoryCard.tsx for the full rationale on the
            negative-margin trick. Icons are aria-hidden so accessible
            names remain exactly: author = "<author>", parent = "parent",
            title = "<title>" — preserves every `getByRole('link',
            { name: ... })` assertion.

            Nested replies in this article render via `Comment` / `CommentTree`
            and deliberately keep the compact `›` byline — the tree structure
            handles parent location, so the unified row would just add density. */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-muted-foreground mb-3">
          <AuthorByline author={comment.author} />

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
              // `min-w-0` lets the link shrink below its intrinsic content
              // width when it wraps onto its own row (the meta row is
              // `flex-wrap`, so a long title forms a second row by itself);
              // `max-w-full` clamps it to the container width so the inner
              // `truncate` span can ellipsize instead of letting an
              // arbitrarily-long HN title spill onto a second line. The
              // icon gets `shrink-0` so it always stays visible — only the
              // text shrinks/ellipsizes.
              <Link
                to={`/item/${itemId}`}
                state={{ isComment: false }}
                className={`${metaPillClass} min-w-0 max-w-full`}
              >
                <MessagesSquare aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{itemTitle}</span>
              </Link>
            ) : itemId != null && !loading ? (
              // Resolved-but-titleless fallback. We have the focal item id
              // (so the comment IS a permalink/fullscreen view of a known
              // story), `loading` has settled, and yet `itemTitle` never
              // arrived — either the parent fetch errored, the item came
              // back without a title (extremely rare for HN stories), or
              // an upstream consumer chose not to thread the title in.
              // Show a generic but navigable "story" link instead of
              // sitting on the skeleton forever — the user still has a
              // working path back to the discussion root.
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

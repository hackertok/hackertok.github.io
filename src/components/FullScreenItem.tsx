import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useItemWithComments } from '../hooks/useItemWithComments';
import { CommentTree, CommentSkeletonTree } from '../components';
import { formatTimeAgo, getHostname } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import { useIsViewed, markViewedWithTime } from '../utils/viewedItems';
import type { StoryItem } from '../types';

// Skeleton for the full-screen item — fills viewport (mobile)
export function FullScreenItemSkeleton() {
  return (
    <div className="animate-pulse px-4 py-4 min-h-screen">
      {/* Title skeleton */}
      <div className="h-5 bg-skeleton rounded w-full mb-2" />
      <div className="h-5 bg-skeleton rounded w-3/4 mb-3" />
      
      {/* Meta skeleton */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-4 bg-skeleton rounded w-16" />
        <div className="h-4 bg-skeleton rounded w-20" />
        <div className="h-4 bg-skeleton rounded w-14" />
      </div>
      
      {/* Comments count skeleton */}
      <div className="border-t border-border pt-4">
        <div className="h-4 bg-skeleton rounded w-28 mb-3" />
        <CommentSkeletonTree count={12} />
      </div>
    </div>
  );
}

/** Full-screen item component for swipe viewer. Renders stories and jobs (not comments). */
interface FullScreenItemProps {
  itemId: number;
  initialItem?: StoryItem;
  isPriority?: boolean;
  deferComments?: boolean;
}

export function FullScreenItem({ itemId, initialItem, isPriority = true, deferComments = false }: FullScreenItemProps) {
  const { item, comments, itemLoading, commentsLoading, error } = useItemWithComments(itemId, {
    initialItem: initialItem ?? null,
    skipOrderingCompletion: true,
    isPriority,
    deferComments,
  });

  const viewed = useIsViewed(itemId);

  const itemText = item?.text;
  const sanitizedText = useMemo(
    () => itemText ? sanitizeHtml(itemText) : '',
    [itemText]
  );

  if (itemLoading && !item) {
    return (
      <div className="full-screen-item">
        <FullScreenItemSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <div className="text-center px-4">
          <p className="text-destructive mb-4">Failed to load item</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!item || item.type === 'comment') {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <p className="text-muted-foreground">Item not found</p>
      </div>
    );
  }

  // item is now narrowed to StoryItem | JobItem (both have title, points, url)
  const hostname = getHostname(item.url);
  
  // Build Algolia "past" search URL
  const pastUrl = `https://hn.algolia.com/?query=${encodeURIComponent(item.title)}&type=story&dateRange=all&sort=byDate&storyText=false&prefix&page=0`;

  return (
    <div className="full-screen-item">
      <div className="px-4 py-4">
        {/* Item header */}
        <article className="mb-4 pb-4 border-b border-border">
          <h1 className={`text-lg font-semibold mb-2 leading-snug ${viewed ? 'text-viewed' : 'text-foreground'}`}>
            {item.url ? (
              <a
                href={item.url}
                className="hover:text-accent transition-colors"
                onClick={() => markViewedWithTime(item.id)}
              >
                {item.title}
              </a>
            ) : (
              item.title
            )}
            {hostname && (
              <span className="ml-1.5 text-[13px] text-muted-foreground font-normal">
                (<Link
                  to={`/from/${hostname}`}
                  className="hover:text-accent transition-colors"
                >
                  {hostname}
                </Link>)
              </span>
            )}
          </h1>

          {/* Meta info */}
          <div className="text-[13px] text-muted-foreground mb-2">
            <span>{item.points} points</span>
            <span> by </span>
            <span>{item.author}</span>
            <span> {formatTimeAgo(item.createdAt)}</span>
            <span className="mx-1.5">|</span>
            <a
              href={pastUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              past
            </a>
            <span className="mx-1.5">|</span>
            <span>{item.type !== 'job' ? item.commentCount : 0} comments</span>
          </div>

          {/* Item text (for Ask HN, etc.) */}
          {sanitizedText && (
            <div
              className="mt-3 comment-content text-foreground text-[15px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: sanitizedText }}
            />
          )}
        </article>

        {/* Comments section */}
        <section>
          {commentsLoading && !comments ? (
            <CommentSkeletonTree count={12} />
          ) : (
            <CommentTree comments={comments ?? []} />
          )}
        </section>
      </div>
    </div>
  );
}

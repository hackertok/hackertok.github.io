import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronUp, Clock, Globe, MessageSquare } from 'lucide-react';
import { getHostname } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import { useIsViewed, markViewedWithTime } from '../utils/viewedItems';
import { metaItemClass, metaPillClass } from '../lib/classes';
import { AuthorByline } from './AuthorByline';
import { RelativeTime } from './RelativeTime';
import type { Item } from '../types';

interface ItemArticleProps {
  item: Item & { title: string; points: number; url?: string; commentCount?: number };
  className?: string;
}

/** Shared item header (title, meta, text) used by both ItemDetail and FullScreenItem. */
export function ItemArticle({ item, className = 'mb-4 pb-4 border-b border-border' }: ItemArticleProps) {
  const viewed = useIsViewed(item.id);
  const hostname = getHostname(item.url);

  const itemText = item.text;
  const sanitizedText = useMemo(
    () => itemText ? sanitizeHtml(itemText) : '',
    [itemText]
  );

  return (
    // `story-stage-leader` lets PageStage's `.play-real` rule animate
    // the whole header as one unit at slot 0 (no delay) so the focal
    // point reads cleanly instead of cascading inside itself.
    <article className={`${className} story-stage-leader`}>
      <h1 className={`text-xl font-semibold mb-2 leading-snug ${viewed ? 'text-viewed' : 'text-foreground'}`}>
        {item.url ? (
          <a
            href={item.url}
            rel="noreferrer"
            className="hover:text-accent transition-colors"
            onClick={() => markViewedWithTime(item.id)}
          >
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h1>

      {/* Meta row order matches StoryCard. Comments stays a non-
          clickable span here (we're already on the detail page).
          `emptyFallback="hide"` preserves ItemArticle's historical
          behavior of dropping the author slot entirely when no handle
          is present. */}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-muted-foreground mb-2">
        <span className={metaItemClass}>
          <ChevronUp aria-hidden className="size-3.5" />
          <span>{item.points ?? 0} points</span>
        </span>

        {hostname && (
          <Link to={`/from/${hostname}`} className={metaPillClass}>
            <Globe aria-hidden className="size-3.5" />
            {hostname}
          </Link>
        )}

        <span className={metaItemClass}>
          <Clock aria-hidden className="size-3.5" />
          <RelativeTime timestamp={item.createdAt} />
        </span>

        <AuthorByline author={item.author} emptyFallback="hide" />

        <span className={metaItemClass}>
          <MessageSquare aria-hidden className="size-3.5" />
          <span>{item.type !== 'job' ? (item.commentCount ?? 0) : 0} comments</span>
        </span>
      </div>

      {sanitizedText && (
        <div
          className="story-body comment-content"
          dangerouslySetInnerHTML={{ __html: sanitizedText }}
        />
      )}
    </article>
  );
}

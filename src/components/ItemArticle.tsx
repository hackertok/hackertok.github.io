import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatTimeAgo, formatAbsoluteTime, safeISOString, getHostname } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import { useIsViewed, markViewedWithTime } from '../utils/viewedItems';
import type { Item } from '../types';

interface ItemArticleProps {
  item: Item & { title: string; points: number; url?: string; commentCount?: number };
  className?: string;
}

/** Shared item header (title, meta, text) used by both ItemDetail and FullScreenItem. */
export function ItemArticle({ item, className = 'mb-4 pb-4 border-b border-border' }: ItemArticleProps) {
  const viewed = useIsViewed(item.id);
  const hostname = getHostname(item.url);
  const pastUrl = `https://hn.algolia.com/?query=${encodeURIComponent(item.title)}&type=story&dateRange=all&sort=byDate&storyText=false&prefix&page=0`;

  const itemText = item.text;
  const sanitizedText = useMemo(
    () => itemText ? sanitizeHtml(itemText) : '',
    [itemText]
  );

  return (
    <article className={className}>
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
        {hostname && (
          <span className="ml-1.5 text-base text-muted-foreground font-normal">
            (<Link
              to={`/from/${hostname}`}
              className="hover:text-accent transition-colors"
            >
              {hostname}
            </Link>)
          </span>
        )}
      </h1>

      <div className="text-sm text-muted-foreground mb-2">
        <span>{item.points} points</span>
        <span> by </span>
        <span>{item.author}</span>
        {' '}<time dateTime={safeISOString(item.createdAt)} title={formatAbsoluteTime(item.createdAt)}>{formatTimeAgo(item.createdAt)}</time>
        <span className="mx-1.5">|</span>
        <a
          href={pastUrl}
          rel="noreferrer"
          className="hover:text-accent transition-colors"
        >
          past
        </a>
        <span className="mx-1.5">|</span>
        <span>{item.type !== 'job' ? (item.commentCount ?? 0) : 0} comments</span>
      </div>

      {sanitizedText && (
        <div
          className="mt-3 comment-content text-foreground text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: sanitizedText }}
        />
      )}
    </article>
  );
}

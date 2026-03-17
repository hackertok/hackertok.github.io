import { useParams, Link } from 'react-router-dom';
import { useMemo, useEffect } from 'react';
import { useItemWithComments } from '../hooks/useItemWithComments';
import { CommentTree, ItemDetailSkeleton, CommentSkeletonTree, CommentDetail } from '../components';
import { formatTimeAgo, getHostname } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useIsViewed, markViewedWithTime } from '../utils/viewedItems';

export function ItemDetail() {
  const { id } = useParams();
  const viewed = useIsViewed(id ?? '');
  const { item, comments, itemLoading, commentsLoading, error } = useItemWithComments(id ?? '');
  
  // Set document title to item title, or 'Item not found' on error/missing
  const documentTitle = (!id || error || (!itemLoading && !item)) ? 'Item not found' : (item && 'title' in item ? item.title : undefined);
  useDocumentTitle(documentTitle);
  
  // Scroll to top on navigation
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);
  
  // useMemo must be called unconditionally (before any returns)
  const itemText = item?.text;
  const sanitizedText = useMemo(
    () => itemText ? sanitizeHtml(itemText) : '',
    [itemText]
  );

  // Invalid or missing item ID
  if (!id) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-8 text-center">
        <p className="text-muted-foreground mb-4">Item not found</p>
        <Link to="/" className="text-accent hover:underline">Back to feed</Link>
      </div>
    );
  }

  // Show full skeleton only if item is loading
  if (itemLoading && !item) {
    return <ItemDetailSkeleton />;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-8 text-center">
        <p className="text-destructive mb-4">Failed to load item: {error}</p>
        <Link
          to="/"
          className="text-accent hover:underline"
        >
          Back to feed
        </Link>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-8 text-center">
        <p className="text-muted-foreground mb-4">Item not found</p>
        <Link
          to="/"
          className="text-accent hover:underline"
        >
          Back to feed
        </Link>
      </div>
    );
  }

  // Comment permalink: render dedicated comment detail page
  if (item.type === 'comment') {
    return <CommentDetail commentId={id} initialData={{ author: item.author, text: item.text, createdAt: item.createdAt, parentId: item.parent }} />;
  }

  const hostname = getHostname(item.url);
  
  // Build Algolia "past" search URL for this item title
  const pastUrl = `https://hn.algolia.com/?query=${encodeURIComponent(item.title)}&type=story&dateRange=all&sort=byDate&storyText=false&prefix&page=0`;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      {/* Item header - shown immediately */}
      <article className="mb-6 pb-4 border-b border-border">
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

        {/* Meta: "16 points by idw 23 minutes ago | past | 52 comments" */}
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

      {/* Comments section - progressive loading */}
      <section>
        {commentsLoading && !comments ? (
          <CommentSkeletonTree count={12} />
        ) : (
          <CommentTree comments={comments ?? []} />
        )}
      </section>
    </div>
  );
}

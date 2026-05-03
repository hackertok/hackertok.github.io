import { useParams, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useItemWithComments } from '../hooks/useItemWithComments';
import { ItemDetailSkeleton, CommentDetail, StateView, CommentsSection, ItemArticle, PageStage } from '../components';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { FEED_PATHS } from '../config/feedTypes';
import type { LocationState } from '../types';

export function ItemDetail() {
  const { id } = useParams();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  // Back target for "Back to feed" on error/not-found.
  // Priority: fromUser > fromDomain > feed > home (most specific wins).
  const feedFrom = locationState?.from;
  const fromDomain = locationState?.fromDomain;
  const fromUser = locationState?.fromUser;
  const feedPath = fromUser
    ? `/submitted/${fromUser}`
    : fromDomain
      ? `/from/${fromDomain}`
      : feedFrom
        ? FEED_PATHS[feedFrom]
        : '/';
  const { item, comments, itemLoading, commentsLoading, error, isNotFound, commentsError, refresh } = useItemWithComments(id ?? '');

  const { isOnline } = useNetworkStatus();
  const { isRetrying: isItemRetrying, resetRetry: resetItemRetry } = useAutoRetry({
    error: isNotFound ? null : error,
    retryFn: () => void refresh(),
    isOnline,
  });
  const documentTitle = (!id || isNotFound || (!itemLoading && !item))
    ? 'Item not found'
    : error ? 'Failed to load item'
    : (item && 'title' in item ? item.title : undefined);
  useDocumentTitle(documentTitle);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);
  
  if (!id) {
    return (
      <div className="page-state-center-padded">
        <StateView variant="not-found" action={{ label: 'Back to feed', to: feedPath }} />
      </div>
    );
  }

  // CRITICAL: branches below MUST gate on `!itemLoading` — the early
  // `(itemLoading && !item)` skeleton short-circuit is gone, so
  // without these gates loading would fall through to not-found
  // (item is null during load) or attempt the CommentDetail redirect.

  if (error && !isItemRetrying) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant={isNotFound ? 'not-found' : 'error'}
          title={isNotFound ? undefined : 'Failed to load item'}
          description={isNotFound ? undefined : error}
          action={isNotFound ? { label: 'Back to feed', to: feedPath } : { label: 'Try Again', onClick: () => { resetItemRetry(); void refresh(); } }}
        />
      </div>
    );
  }

  // Pre-emptive retry skeleton — fires while useAutoRetry is between
  // attempts. Wraps with the same chrome the post-load render uses
  // so the gutter matches.
  if (error && isItemRetrying) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
        <ItemDetailSkeleton />
      </div>
    );
  }

  if (!itemLoading && !item) {
    return (
      <div className="page-state-center-padded">
        <StateView variant="not-found" action={{ label: 'Back to feed', to: feedPath }} />
      </div>
    );
  }

  if (!itemLoading && item?.type === 'comment') {
    return <CommentDetail commentId={id} initialData={{ author: item.author, text: item.text, createdAt: item.createdAt, parentId: item.parent }} />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      {/* `loading={itemLoading || commentsLoading}` holds the skeleton
          until both header and comments are ready. Trade-off: cached-
          item / stale-comments adds ~200-500ms to the skeleton, but
          visual coherence wins over the alternative (header lands,
          then comments cascade separately, reading as disjointed). */}
      <PageStage
        loading={itemLoading || commentsLoading}
        skeleton={<ItemDetailSkeleton />}
      >
        {item && item.type !== 'comment' && (
          <>
            <ItemArticle item={item} className="mb-6 pb-4 border-b border-border" />
            <section>
              <CommentsSection
                comments={comments}
                commentsError={commentsError}
                onRetry={() => void refresh()}
                storyAuthor={item.author}
              />
            </section>
          </>
        )}
      </PageStage>
    </div>
  );
}

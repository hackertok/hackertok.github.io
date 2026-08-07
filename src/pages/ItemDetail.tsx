import { useParams } from 'react-router';
import { useEffect } from 'react';
import { useItemWithComments } from '../hooks/useItemWithComments';
import { ItemDetailSkeleton, CommentDetail, StateView, CommentsSection, ItemArticle, PageStage } from '../components';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';

export function ItemDetail() {
  const { id } = useParams();
  const { item, comments, itemLoading, commentsLoading, error, isNotFound, commentsError, refresh } = useItemWithComments(id ?? '');

  const { isOnline } = useNetworkStatus();
  const { isRetrying: isItemRetrying, resetRetry: resetItemRetry } = useAutoRetry({
    error: isNotFound ? null : error,
    retryFn: refresh,
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
        <StateView variant="not-found" action={{ label: 'Back to Home', to: '/' }} />
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
          action={isNotFound ? { label: 'Back to Home', to: '/' } : { label: 'Try Again', onClick: () => { resetItemRetry(); void refresh().catch(() => { /* error state set internally */ }); } }}
        />
      </div>
    );
  }

  // Pre-emptive retry skeleton while useAutoRetry is between attempts.
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
        <StateView variant="not-found" action={{ label: 'Back to Home', to: '/' }} />
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
                onRetry={refresh}
                storyAuthor={item.author}
              />
            </section>
          </>
        )}
      </PageStage>
    </div>
  );
}

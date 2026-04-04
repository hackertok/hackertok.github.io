import { useParams, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useItemWithComments } from '../hooks/useItemWithComments';
import { ItemDetailSkeleton, CommentDetail, StateView, CommentsSection, ItemArticle } from '../components';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { FEED_PATHS } from '../config/feedTypes';
import type { LocationState } from '../types';

export function ItemDetail() {
  const { id } = useParams();
  const location = useLocation();
  const feedFrom = (location.state as LocationState | null)?.from;
  const feedPath = feedFrom ? FEED_PATHS[feedFrom] : '/';
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
  
  // Scroll to top on navigation
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

  // Show full skeleton only if item is loading
  if (itemLoading && !item) {
    return <ItemDetailSkeleton />;
  }

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

  if (error && isItemRetrying) {
    return <ItemDetailSkeleton />;
  }

  if (!item) {
    return (
      <div className="page-state-center-padded">
        <StateView variant="not-found" action={{ label: 'Back to feed', to: feedPath }} />
      </div>
    );
  }

  // Comment permalink: render dedicated comment detail page
  if (item.type === 'comment') {
    return <CommentDetail commentId={id} initialData={{ author: item.author, text: item.text, createdAt: item.createdAt, parentId: item.parent }} />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      <ItemArticle item={item} className="mb-6 pb-4 border-b border-border" />
      <section>
        <CommentsSection comments={comments} commentsLoading={commentsLoading} commentsError={commentsError} onRetry={() => void refresh()} />
      </section>
    </div>
  );
}

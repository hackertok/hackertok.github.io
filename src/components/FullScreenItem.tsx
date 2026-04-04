import { useItemWithComments } from '../hooks/useItemWithComments';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { CommentSkeletonTree } from '../components';
import { CommentsSection } from './CommentsSection';
import { ItemArticle } from './ItemArticle';
import { StateView } from './StateView';
import type { StoryItem } from '../types';

// Skeleton for the full-screen item — fills viewport (mobile)
export function FullScreenItemSkeleton() {
  return (
    <div className="animate-pulse px-4 py-4 min-h-full">
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
  const { item, comments, itemLoading, commentsLoading, error, isNotFound, commentsError, refresh } = useItemWithComments(itemId, {
    initialItem: initialItem ?? null,
    skipOrderingCompletion: true,
    isPriority,
    deferComments,
  });

  const { isOnline } = useNetworkStatus();
  const { isRetrying } = useAutoRetry({
    error: isNotFound ? null : error,
    retryFn: () => void refresh(),
    isOnline,
  });

  if (itemLoading && !item) {
    return (
      <div className="full-screen-item">
        <FullScreenItemSkeleton />
      </div>
    );
  }

  if (error && !isRetrying) {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <StateView
          variant={isNotFound ? 'not-found' : 'error'}
          title={isNotFound ? undefined : 'Failed to load item'}
          description={isNotFound ? undefined : error}
          action={isNotFound ? undefined : { label: 'Retry', onClick: () => void refresh() }}
        />
      </div>
    );
  }

  if (error && isRetrying) {
    return (
      <div className="full-screen-item">
        <FullScreenItemSkeleton />
      </div>
    );
  }

  if (!item || item.type === 'comment') {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <StateView variant="not-found" />
      </div>
    );
  }

  return (
    <div className="full-screen-item">
      <div className="px-4 py-4">
        <ItemArticle item={item} />
        <section>
          <CommentsSection comments={comments} commentsLoading={commentsLoading} commentsError={commentsError} onRetry={() => void refresh()} />
        </section>
      </div>
    </div>
  );
}

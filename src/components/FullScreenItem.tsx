import { useItemWithComments } from '../hooks/useItemWithComments';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { CommentSkeletonTree } from '../components';
import { CommentsSection } from './CommentsSection';
import { FullScreenChrome } from './FullScreenChrome';
import { ItemArticle } from './ItemArticle';
import { PageStage } from './PageStage';
import { StateView } from './StateView';
import type { StoryItem } from '../types';

// Inner content ONLY — the `full-screen-item` + `px-4 py-4` chrome
// MUST be supplied by the consumer (FullScreenItem wraps PageStage
// in it; bare-context callers use `FullScreenItemSkeletonPanel`).
// Without this split, bare contexts had `px-4` once while PageStage
// renders had it twice, making the bare skeleton render at a
// different width than the post-load skeleton.
//
// Title `h-6 w-3/4` ≤ real focal h1's `text-xl leading-snug`
// (~27.5px line box) so PageStage's grid stack sizes the cell to the
// real h1 and there's no contraction when the overlay unmounts.
export function FullScreenItemSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-2">
        <div className="h-6 bg-skeleton rounded w-3/4" />
      </div>

      {/* Meta — 5 pills (points / domain / time / user / comments). */}
      <div className="flex items-center gap-x-3.5 gap-y-2 mb-4 min-h-5">
        <div className="h-3 bg-skeleton rounded w-12" />
        <div className="h-3 bg-skeleton rounded w-20" />
        <div className="h-3 bg-skeleton rounded w-14" />
        <div className="h-3 bg-skeleton rounded w-16" />
        <div className="h-3 bg-skeleton rounded w-16" />
      </div>

      <div className="border-t border-border pt-4">
        <CommentSkeletonTree count={12} />
      </div>
    </div>
  );
}

// Bare-context wrapper that supplies the same `full-screen-item` +
// `px-4 py-4` chrome the post-load FullScreenItem renders, so the
// gutter is consistent and the swap is invisible.
export function FullScreenItemSkeletonPanel() {
  return (
    <FullScreenChrome>
      <FullScreenItemSkeleton />
    </FullScreenChrome>
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

  // Branches below MUST gate on `!itemLoading` (same rule as
  // ItemDetail) so they don't fire during the skeleton phase.

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
    return <FullScreenItemSkeletonPanel />;
  }

  if (!itemLoading && (!item || item.type === 'comment')) {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <StateView variant="not-found" />
      </div>
    );
  }

  return (
    <FullScreenChrome>
      {/* `triggerWhen={isPriority}` holds the entrance animation
          for offscreen swipe panels (distance > 1) until the user
          swipes to them — otherwise prefetched panels would burn
          their cascade in the dark behind the focal panel. */}
      <PageStage
        loading={itemLoading || commentsLoading}
        skeleton={<FullScreenItemSkeleton />}
        triggerWhen={isPriority}
      >
        {item && item.type !== 'comment' && (
          <>
            <ItemArticle item={item} />
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
    </FullScreenChrome>
  );
}

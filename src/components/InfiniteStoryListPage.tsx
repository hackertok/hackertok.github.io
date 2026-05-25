import { useCallback, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import { StoryCard } from './StoryCard';
import { Spinner } from './Spinner';
import { StoryCardSkeletonList } from './StoryCardSkeleton';
import { StateView } from './StateView';
import { PageStage } from './PageStage';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { useStaggerCascadeSlots } from '../hooks/useStaggerCascadeSlots';
import type { FeedType, StoryItem } from '../types';

/**
 * Hook-output shape consumed by `InfiniteStoryListPage`. All three
 * `use*InfiniteStories` hooks expose at least these fields; pages may
 * destructure additional ones (e.g. session/scroll restoration on the
 * main feed) before passing the rest in.
 */
export interface InfiniteStoryListResult {
  stories: StoryItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

export interface StoryCardExtras {
  listType?: FeedType;
  fromDomain?: string;
  fromUser?: string;
  onBeforeNavigate?: () => void;
}

interface InfiniteStoryListPageProps {
  result: InfiniteStoryListResult;
  /**
   * Stable primitive key for context changes. Resets cascade state
   * so the new feed gets a fresh cold-load entrance.
   */
  resetKey: string;
  storyCardExtras?: StoryCardExtras;
  /** Empty-state title. Omit to skip empty rendering. */
  emptyTitle?: string;
  failTitle?: string;
}

/**
 * Shared infinite-scroll story list. Owns cascade slots,
 * load-more trigger, auto-retry, and PageStage.
 */
export function InfiniteStoryListPage({
  result,
  resetKey,
  storyCardExtras,
  emptyTitle,
  failTitle = 'Failed to load items',
}: InfiniteStoryListPageProps) {
  const { stories, loading, error, hasMore, loadMore } = result;

  const getSlot = useStaggerCascadeSlots(loading, stories.length, resetKey);

  const { ref, inView } = useInView({
    threshold: 0,
    rootMargin: '200px',
  });

  const { isOnline } = useNetworkStatus();
  const { isRetrying, resetRetry } = useAutoRetry({
    error,
    retryFn: loadMore,
    isOnline,
  });

  useEffect(() => {
    if (inView && !loading && hasMore && !error) {
      void loadMore().catch(() => { /* error state set internally */ });
    }
  }, [inView, loading, hasMore, error, loadMore]);

  const retryLoadMore = useCallback(() => {
    resetRetry();
    void loadMore().catch(() => { /* error state set internally */ });
  }, [resetRetry, loadMore]);

  // Pre-PageStage error / retry-skeleton branches replace the whole
  // layout (no skeleton overlay), so they sit above the wrapper.
  if (error && stories.length === 0 && !isRetrying) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="error"
          title={failTitle}
          description={error}
          action={{ label: 'Try Again', onClick: retryLoadMore }}
        />
      </div>
    );
  }

  if (error && stories.length === 0 && isRetrying) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
        <StoryCardSkeletonList count={12} />
      </div>
    );
  }

  if (emptyTitle && stories.length === 0 && !loading) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="empty"
          title={emptyTitle}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      {/* `loading` is gated on `stories.length === 0` so a refresh /
          context change with cached cards doesn't blank them out. */}
      <PageStage
        loading={stories.length === 0 && loading}
        skeleton={<StoryCardSkeletonList count={12} />}
      >
        <>
          <div className="space-y-0 divide-y divide-border">
            {stories.map((story, index) => (
              <StoryCard
                key={story.id}
                story={story}
                index={index}
                {...getSlot(index)}
                {...storyCardExtras}
              />
            ))}
          </div>

          {hasMore && (
            <div ref={ref} className="py-4">
              {loading && <Spinner />}
            </div>
          )}

          {!hasMore && stories.length > 0 && (
            <StateView variant="end" className="flex flex-col items-center justify-center text-center pt-8" />
          )}

          {error && stories.length > 0 && !isRetrying && (
            <div className="pb-4">
              <StateView
                variant="error"
                compact
                description={error}
                action={{ label: 'Retry', onClick: retryLoadMore }}
                className="flex items-center justify-center gap-3 py-4 text-center"
              />
            </div>
          )}

          {isRetrying && stories.length > 0 && (
            <div className="py-4 flex justify-center">
              <Spinner />
            </div>
          )}
        </>
      </PageStage>
    </div>
  );
}

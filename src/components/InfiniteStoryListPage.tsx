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

/** Pass-through props forwarded to every `StoryCard`. */
export interface StoryCardExtras {
  listType?: FeedType;
  fromDomain?: string;
  fromUser?: string;
  onBeforeNavigate?: () => void;
}

interface InfiniteStoryListPageProps {
  /** Hook output (`{ stories, loading, error, hasMore, loadMore }`). */
  result: InfiniteStoryListResult;
  /**
   * Primitive identifying the current feed context (feed type /
   * canonical domain / username). Forwarded to
   * `useStaggerCascadeSlots` so navigating between contexts collapses
   * cascade state and the new feed gets a fresh cold-load entrance.
   */
  resetKey: string;
  /** Extra props passed through to each `StoryCard`. */
  storyCardExtras?: StoryCardExtras;
  /**
   * If supplied, an empty `StateView` with this title is rendered when
   * `stories.length === 0` after the cold load resolves. Pass undefined
   * to skip the empty state — used by the main feed where empty is
   * effectively unreachable in normal operation.
   */
  emptyTitle?: string;
  /** Title for the full-page error `StateView`. Defaults to `"Failed to load items"`. */
  failTitle?: string;
}

/**
 * Shared layout for the three infinite story-list pages (main feed,
 * domain submissions, user submissions). Owns:
 *   • cascade-slot accounting (`useStaggerCascadeSlots`)
 *   • intersection-observer load-more trigger
 *   • network / auto-retry plumbing
 *   • `PageStage` skeleton swap and the standard footer states
 *     (spinner / end-of-feed / in-list error / in-list retry)
 *
 * Page-level concerns (route params, document title, scroll
 * restoration, hook selection) stay in the consumer; this component
 * only renders the well-typed `result` shape.
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
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
        <StateView
          variant="error"
          title={failTitle}
          description={error}
          action={{ label: 'Try Again', onClick: retryLoadMore }}
          className="page-state-center"
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

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      {/* `loading` is gated on `stories.length === 0` so a refresh /
          context change with cached cards doesn't blank them out. The
          empty-state StateView sits inside `children` so it inherits
          the `'done'` opacity baseline (no spurious cascade). */}
      <PageStage
        loading={stories.length === 0 && loading}
        skeleton={<StoryCardSkeletonList count={12} />}
      >
        {emptyTitle && stories.length === 0 ? (
          <StateView
            variant="empty"
            title={emptyTitle}
            className="page-state-center"
          />
        ) : (
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

            {/* Infinite scroll trigger */}
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
        )}
      </PageStage>
    </div>
  );
}

import { useParams } from 'react-router-dom';
import { useCallback, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import { StoryCard, Spinner, StoryCardSkeletonList, StateView } from '../components';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import {
  useUserInfiniteStories,
  formatNoUserSubmissionsTitle,
} from '../hooks/useUserInfiniteStories';

export function UserSubmissions() {
  const { id } = useParams<{ id: string }>();
  const username = id ?? '';

  // HN's `/submitted?id=USER` is stories-only (despite the misleading
  // "submitted" label that includes comments in user.submitted on Firebase).
  // Title and empty state agree on that wording so the desktop list and the
  // swipe viewer (`SwipeUserSubmissionsViewer`) read identically.
  useDocumentTitle(username ? `Submissions by ${username}` : undefined);

  const { stories, loading, error, hasMore, loadMore } = useUserInfiniteStories(username);

  const { ref, inView } = useInView({
    threshold: 0,
    rootMargin: '200px',
  });

  const { isOnline } = useNetworkStatus();
  const { isRetrying, resetRetry } = useAutoRetry({
    error,
    retryFn: () => void loadMore(),
    isOnline,
    enabled: !!username,
  });

  useEffect(() => {
    if (inView && !loading && hasMore && !error) {
      void loadMore();
    }
  }, [inView, loading, hasMore, error, loadMore]);

  const retryLoadMore = useCallback(() => {
    resetRetry();
    void loadMore();
  }, [resetRetry, loadMore]);

  if (!username) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="not-found"
          title="No user specified"
          action={{ label: 'Return to Home', to: '/' }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      {stories.length === 0 && loading ? (
        <StoryCardSkeletonList count={12} />
      ) : error && stories.length === 0 && !isRetrying ? (
        <StateView
          variant="error"
          title="Failed to load submissions"
          description={error}
          action={{ label: 'Try Again', onClick: retryLoadMore }}
          className="page-state-center"
        />
      ) : error && stories.length === 0 && isRetrying ? (
        <StoryCardSkeletonList count={12} />
      ) : stories.length === 0 ? (
        <StateView
          variant="empty"
          title={formatNoUserSubmissionsTitle(username)}
          className="page-state-center"
        />
      ) : (
        <>
          <div className="space-y-0 divide-y divide-border">
            {stories.map(story => (
              <StoryCard key={story.id} story={story} fromUser={username} />
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
              <StateView variant="error" compact description={error} action={{ label: 'Retry', onClick: retryLoadMore }} className="flex items-center justify-center gap-3 py-4 text-center" />
            </div>
          )}

          {isRetrying && stories.length > 0 && (
            <div className="py-4 flex justify-center">
              <Spinner />
            </div>
          )}
        </>
      )}
    </div>
  );
}

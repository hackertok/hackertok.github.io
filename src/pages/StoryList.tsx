import { useEffect, useRef, useLayoutEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import { StoryCard, Spinner, StoryCardSkeletonList, StateView } from '../components';
import { useInfiniteStories } from '../hooks/useInfiniteStories';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { FEED_TYPE_TITLES } from '../config/feedTypes';
import type { FeedType } from '../types';

export function StoryList({ type }: { type: FeedType }) {
  // Set document title based on section type
  useDocumentTitle(FEED_TYPE_TITLES[type]);
  
  const { 
    stories, 
    loading, 
    error, 
    hasMore, 
    loadMore, 
    reset, 
    isFromCache,
    isFromSession,
    initialScrollY,
    saveSessionState,
  } = useInfiniteStories(type);
  const { isOnline } = useNetworkStatus();
  const { isRetrying, resetRetry } = useAutoRetry({
    error,
    retryFn: () => void loadMore(),
    isOnline,
  });
  const { ref, inView } = useInView({
    threshold: 0,
    rootMargin: '200px',
  });
  
  // Track previous type to only reset on CHANGE, not initial mount
  const prevTypeRef = useRef(type);
  const hasRestoredScroll = useRef(false);

  // Reset only when type CHANGES (not on initial mount)
  useEffect(() => {
    if (prevTypeRef.current !== type) {
      prevTypeRef.current = type;
      hasRestoredScroll.current = false;
      reset();
    }
  }, [type, reset]);

  // Restore scroll position from session (before paint), or reset to top
  useLayoutEffect(() => {
    if (isFromSession && initialScrollY > 0 && !hasRestoredScroll.current && stories.length > 0) {
      hasRestoredScroll.current = true;
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        window.scrollTo(0, initialScrollY);
      });
    } else if (!isFromSession && !hasRestoredScroll.current) {
      // Not from session (e.g., logo click) - scroll to top
      hasRestoredScroll.current = true;
      window.scrollTo(0, 0);
    }
  }, [isFromSession, initialScrollY, stories.length]);

  // Load initial items (or revalidate if showing cached data)
  // Skip if we restored from session - user is coming back, don't refetch
  useEffect(() => {
    if (isFromSession) return; // Don't refetch on back navigation
    
    // Trigger load if no items, OR if we have cached data that needs revalidation.
    // The !error guard prevents an infinite retry loop: without it, loadMore() sets
    // loading→true then error→msg then loading→false, which re-triggers this effect
    // (stories still empty, loading now false) creating a rapid error↔loading cycle.
    if ((stories.length === 0 || isFromCache) && !loading && !error) {
      void loadMore();
    }
  }, [stories.length, loading, loadMore, isFromCache, isFromSession, error]);

  // Load more when scrolling near bottom (don't auto-retry on error — user clicks Retry)
  useEffect(() => {
    if (inView && !loading && hasMore && !error) {
      void loadMore();
    }
  }, [inView, loading, hasMore, loadMore, error]);

  if (error && stories.length === 0 && !isRetrying) {
    return (
      <StateView
        variant="error"
        title="Failed to load items"
        description={error}
        action={{ label: 'Try Again', onClick: () => { resetRetry(); void loadMore(); } }}
        className="page-state-center"
      />
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
      {stories.length === 0 && loading ? (
        <StoryCardSkeletonList count={12} />
      ) : (
        <>
          <div className="space-y-0 divide-y divide-border">
            {stories.map((story, index) => (
              <StoryCard key={story.id} story={story} index={index} listType={type} onBeforeNavigate={saveSessionState} />
            ))}
          </div>

          {/* Infinite scroll trigger */}
          {hasMore && (
            <div ref={ref} className="py-4">
              {loading && <Spinner />}
            </div>
          )}

          {!hasMore && stories.length > 0 && (
            <div className="py-8">
              <StateView variant="end" />
            </div>
          )}

          {error && stories.length > 0 && !isRetrying && (
            <div className="pb-4">
              <StateView variant="error" compact description={error} action={{ label: 'Retry', onClick: () => { resetRetry(); void loadMore(); } }} className="flex items-center justify-center gap-3 py-4 text-center" />
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

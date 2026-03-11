import { useEffect, useRef, useLayoutEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import { StoryCard, Spinner, StoryCardSkeletonList } from '../components';
import { useInfiniteStories } from '../hooks/useInfiniteStories';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { STORY_TYPE_TITLES } from '../config/storyTypes';
import type { StoryType } from '../types';

export function StoryList({ type }: { type: StoryType }) {
  // Set document title based on section type
  useDocumentTitle(STORY_TYPE_TITLES[type]);
  
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

  // Load initial stories (or revalidate if showing cached data)
  // Skip if we restored from session - user is coming back, don't refetch
  useEffect(() => {
    if (isFromSession) return; // Don't refetch on back navigation
    
    // Trigger load if no stories, OR if we have cached data that needs revalidation
    if ((stories.length === 0 || isFromCache) && !loading) {
      void loadMore();
    }
  }, [stories.length, loading, loadMore, isFromCache, isFromSession]);

  // Load more when scrolling near bottom
  useEffect(() => {
    if (inView && !loading && hasMore) {
      void loadMore();
    }
  }, [inView, loading, hasMore, loadMore]);

  if (error && stories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-red-500 dark:text-red-400 mb-4">Failed to load stories: {error}</p>
        <button
          onClick={loadMore}
          className="px-4 md:px-8 lg:px-12 py-2 bg-hn-orange text-white rounded-lg hover:bg-orange-600 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      {stories.length === 0 && loading ? (
        <StoryCardSkeletonList count={12} />
      ) : (
        <>
          <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-800/50">
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
            <p className="text-center text-sm text-gray-500 dark:text-gray-500 py-8">
              You&apos;ve reached the end
            </p>
          )}

          {error && stories.length > 0 && (
            <div className="text-center py-4">
              <p className="text-red-500 dark:text-red-400 mb-2">{error}</p>
              <button
                onClick={loadMore}
                className="px-4 md:px-8 lg:px-12 py-2 bg-hn-orange text-white rounded-lg hover:bg-orange-600 transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import { StoryCard, Spinner, StoryCardSkeletonList } from '../components';
import { useInfiniteStories } from '../hooks/useInfiniteStories';

export function StoryList({ type }) {
  const { stories, loading, error, hasMore, loadMore, reset } = useInfiniteStories(type);
  const { ref, inView } = useInView({
    threshold: 0,
    rootMargin: '200px',
  });

  // Reset when type changes
  useEffect(() => {
    reset();
  }, [type, reset]);

  // Load initial stories
  useEffect(() => {
    if (stories.length === 0 && !loading) {
      loadMore();
    }
  }, [stories.length, loading, loadMore]);

  // Load more when scrolling near bottom
  useEffect(() => {
    if (inView && !loading && hasMore) {
      loadMore();
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
        <StoryCardSkeletonList count={15} />
      ) : (
        <>
          <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-800/50">
            {stories.map(story => (
              <StoryCard key={story.id} story={story} />
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
              You've reached the end
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

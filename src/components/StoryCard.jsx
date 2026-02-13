import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import { formatTimeAgo, getHostname } from '../api/hn';
import { usePrefetchStory, shouldPrefetch, cancelAllPrefetches } from '../hooks/usePrefetchStory';

export function StoryCard({ story, onBeforeNavigate }) {
  const hostname = getHostname(story.url);
  const { prefetch, cancel } = usePrefetchStory();
  
  // Observe visibility with 1000px margin (start prefetch early)
  const { ref, inView } = useInView({
    rootMargin: '1000px',
    triggerOnce: true, // Only trigger once per card
  });
  
  // Handle navigation: save session state and cancel prefetches
  const handleNavigate = () => {
    cancelAllPrefetches();
    if (onBeforeNavigate) {
      onBeforeNavigate();
    }
  };
  
  // Prefetch when card becomes visible (with margin)
  useEffect(() => {
    if (inView && shouldPrefetch(story.commentCount)) {
      prefetch(story.id, story.commentCount);
    }
  }, [inView, story.id, story.commentCount, prefetch]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => cancel();
  }, [cancel]);

  return (
    <article ref={ref} className="py-3 first:pt-0">
      <div className="space-y-1">
        {/* Title with hostname */}
        <h2 className="text-[15px] leading-snug font-semibold">
          {story.url ? (
            <a
              href={story.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-900 dark:text-gray-100 hover:text-hn-orange transition-colors"
            >
              {story.title}
            </a>
          ) : (
            <Link
              to={`/item/${story.id}`}
              onClick={handleNavigate}
              className="text-gray-900 dark:text-gray-100 hover:text-hn-orange transition-colors"
            >
              {story.title}
            </Link>
          )}
          {hostname && (
            <span className="ml-1.5 text-[13px] text-gray-500 dark:text-gray-400 font-normal">
              (<Link
                to={`/from/${hostname}`}
                className="hover:text-hn-orange transition-colors"
              >
                {hostname}
              </Link>)
            </span>
          )}
        </h2>

        {/* Meta info: "58 points by pocksuppet 3 hours ago | 17 comments" */}
        <div className="text-[13px] text-gray-600 dark:text-gray-400">
          <span>{story.points ?? 0} points</span>
          <span> by </span>
          <span>{story.author || 'unknown'}</span>
          <span> {formatTimeAgo(story.createdAt)}</span>
          <span className="mx-1.5">|</span>
          <Link
            to={`/item/${story.id}`}
            onClick={handleNavigate}
            className="hover:text-hn-orange transition-colors"
          >
            {story.commentCount ?? 0} comments
          </Link>
        </div>
      </div>
    </article>
  );
}

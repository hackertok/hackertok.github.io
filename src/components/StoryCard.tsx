import { useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import { formatTimeAgo, getHostname } from '../api/hn';
import { usePrefetchStory, cancelAllPrefetches } from '../hooks/usePrefetchStory';
import { useIsViewed, markViewedWithTime } from '../utils/viewedStories';
import type { Story } from '../types';

interface StoryCardProps {
  story: Story;
  index?: number;
  listType?: string;
  onBeforeNavigate?: () => void;
}

export function StoryCard({ story, index = 0, listType = 'top', onBeforeNavigate }: StoryCardProps) {
  const hostname = getHostname(story.url);
  const { startPrefetch, stopPrefetch } = usePrefetchStory();
  const isPrefetchingRef = useRef(false);
  const wasInExitZoneRef = useRef(false); // Track if card was ever in exit zone
  
  // Observe visibility with 800px margin for starting prefetch (eager)
  const { ref: enterRef, inView: enterInView } = useInView({
    rootMargin: '800px',
  });
  
  // Observe visibility with -100px margin for stopping prefetch (only abort when well off-screen)
  const { ref: exitRef, inView: exitInView } = useInView({
    rootMargin: '-100px',
  });
  
  // Merge refs to attach both observers to the same element
  const setRefs = useCallback((node: Element | null) => {
    enterRef(node);
    exitRef(node);
  }, [enterRef, exitRef]);
  
  // Reactive viewed status from localStorage store
  const viewed = useIsViewed(story.id);
  
  // Handle internal title click: mark as viewed, save session state and cancel prefetches
  const handleTitleClick = () => {
    markViewedWithTime(story.id);
    cancelAllPrefetches();
    if (onBeforeNavigate) {
      onBeforeNavigate();
    }
  };
  
  // Handle comments click: save session state and cancel prefetches
  // For text posts (Ask HN), also mark as viewed since comments IS the content
  const handleCommentsClick = () => {
    if (!story.url) {
      markViewedWithTime(story.id);
    }
    cancelAllPrefetches();
    if (onBeforeNavigate) {
      onBeforeNavigate();
    }
  };
  
  // Start prefetch when card enters expanded viewport (800px margin)
  // Pass index for priority ordering (lower index = prefetch first)
  // Re-prefetches if cache was evicted while scrolled away
  useEffect(() => {
    if (enterInView) {
      isPrefetchingRef.current = true;
      startPrefetch(story.id, index);
    }
  }, [enterInView, story.id, index, startPrefetch]);
  
  // Track when card enters the tight exit zone
  useEffect(() => {
    if (exitInView) {
      wasInExitZoneRef.current = true;
    }
  }, [exitInView]);
  
  // Stop prefetch only when card LEAVES the tight viewport (was in, now out)
  useEffect(() => {
    if (!exitInView && wasInExitZoneRef.current && isPrefetchingRef.current) {
      isPrefetchingRef.current = false;
      stopPrefetch();
    }
  }, [exitInView, stopPrefetch]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isPrefetchingRef.current) {
        stopPrefetch();
      }
    };
  }, [stopPrefetch]);

  return (
    <article ref={setRefs} className="py-3 first:pt-0" data-testid="story-card" data-story-id={story.id} data-viewed={viewed}>
      <div className="space-y-1">
        {/* Title with hostname */}
        <h2 className="text-[15px] leading-snug font-semibold">
          {story.url ? (
            <a
              href={story.url}
              className={`hover:text-hn-orange transition-colors ${
                viewed
                  ? 'text-gray-500 dark:text-gray-500'
                  : 'text-gray-900 dark:text-gray-100'
              }`}
              onClick={() => markViewedWithTime(story.id)}
            >
              {story.title}
            </a>
          ) : (
            <Link
              to={`/item/${story.id}`}
              state={{ from: listType }}
              onClick={handleTitleClick}
              className={`hover:text-hn-orange transition-colors ${
                viewed
                  ? 'text-gray-500 dark:text-gray-500'
                  : 'text-gray-900 dark:text-gray-100'
              }`}
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
            state={{ from: listType }}
            onClick={handleCommentsClick}
            className="hover:text-hn-orange transition-colors"
          >
            {story.commentCount ?? 0} comments
          </Link>
        </div>
      </div>
    </article>
  );
}

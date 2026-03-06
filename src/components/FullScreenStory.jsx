import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStoryWithComments } from '../hooks/useStoryWithComments';
import { CommentTree, CommentSkeletonTree } from '../components';
import { formatTimeAgo, getHostname } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import { useIsViewed, markViewedWithTime } from '../utils/viewedStories';

// Skeleton for the full story - fills viewport (mobile)
export function FullScreenStorySkeleton() {
  return (
    <div className="animate-pulse px-4 py-4 min-h-screen">
      {/* Title skeleton */}
      <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-full mb-2" />
      <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-3/4 mb-3" />
      
      {/* Meta skeleton */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-16" />
        <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-20" />
        <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-14" />
      </div>
      
      {/* Comments count skeleton */}
      <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-28 mb-3" />
        <CommentSkeletonTree count={12} />
      </div>
    </div>
  );
}

/**
 * Full-screen story component for swipe viewer
 * Displays story details and comments
 * @param {object} story - Optional pre-loaded story data (avoids redundant fetch)
 * @param {boolean} isPriority - If true (current story), fetch immediately; if false, wait for priority to complete
 * @param {boolean} deferComments - If true, skip comment fetch (for far panels)
 */
export function FullScreenStory({ storyId, story: initialStory, isPriority = true, deferComments = false }) {
  // Skip ordering completion on mobile - users swipe fast, deep comment order doesn't matter
  const { story, comments, storyLoading, commentsLoading, error } = useStoryWithComments(storyId, {
    initialStory,
    skipOrderingCompletion: true,
    isPriority,
    deferComments,
  });

  // Reactive viewed status for title styling
  const viewed = useIsViewed(storyId);

  // Sanitize story text
  const sanitizedText = useMemo(
    () => story?.text ? sanitizeHtml(story.text) : '',
    [story]
  );

  // Show skeleton if loading
  if (storyLoading && !story) {
    return (
      <div className="full-screen-story">
        <FullScreenStorySkeleton />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="full-screen-story flex items-center justify-center min-h-[50vh]">
        <div className="text-center px-4">
          <p className="text-red-500 dark:text-red-400 mb-4">Failed to load story</p>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // No story found
  if (!story) {
    return (
      <div className="full-screen-story flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500 dark:text-gray-400">Story not found</p>
      </div>
    );
  }

  const hostname = getHostname(story.url);
  
  // Build Algolia "past" search URL
  const pastUrl = `https://hn.algolia.com/?query=${encodeURIComponent(story.title)}&type=story&dateRange=all&sort=byDate&storyText=false&prefix&page=0`;

  return (
    <div className="full-screen-story">
      <div className="px-4 py-4">
        {/* Story header */}
        <article className="mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
          <h1 className={`text-lg font-semibold mb-2 leading-snug ${viewed ? 'text-gray-500 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>
            {story.url ? (
              <a
                href={story.url}
                className="hover:text-hn-orange transition-colors"
                onClick={() => markViewedWithTime(story.id)}
              >
                {story.title}
              </a>
            ) : (
              story.title
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
          </h1>

          {/* Meta info */}
          <div className="text-[13px] text-gray-600 dark:text-gray-400 mb-2">
            <span>{story.points} points</span>
            <span> by </span>
            <span>{story.author}</span>
            <span> {formatTimeAgo(story.createdAt)}</span>
            <span className="mx-1.5">|</span>
            <a
              href={pastUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-hn-orange transition-colors"
            >
              past
            </a>
            <span className="mx-1.5">|</span>
            <span>{story.commentCount} comments</span>
          </div>

          {/* Story text (for Ask HN, etc.) */}
          {sanitizedText && (
            <div
              className="mt-3 comment-content text-gray-800 dark:text-gray-200 text-[15px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: sanitizedText }}
            />
          )}
        </article>

        {/* Comments section */}
        <section>
          {commentsLoading && !comments ? (
            <CommentSkeletonTree count={12} />
          ) : (
            <CommentTree comments={comments || []} />
          )}
        </section>
      </div>
    </div>
  );
}

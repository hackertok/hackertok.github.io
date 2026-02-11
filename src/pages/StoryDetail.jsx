import { useParams, Link } from 'react-router-dom';
import { useMemo, useEffect } from 'react';
import { useStoryWithComments } from '../hooks/useStoryWithComments';
import { CommentTree, StoryDetailSkeleton, CommentSkeleton } from '../components';
import { formatTimeAgo, getHostname } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';

// Skeleton for just the comments section
function CommentsSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(5)].map((_, i) => (
        <CommentSkeleton key={i} />
      ))}
    </div>
  );
}

export function StoryDetail() {
  const { id } = useParams();
  const { story, comments, storyLoading, commentsLoading, error } = useStoryWithComments(id);
  
  // Scroll to top on navigation
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);
  
  // useMemo must be called unconditionally (before any returns)
  const sanitizedText = useMemo(
    () => story?.text ? sanitizeHtml(story.text) : '',
    [story]
  );

  // Show full skeleton only if story is loading
  if (storyLoading && !story) {
    return <StoryDetailSkeleton />;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-8 text-center">
        <p className="text-red-500 dark:text-red-400 mb-4">Failed to load story: {error}</p>
        <Link
          to="/"
          className="text-hn-orange hover:underline"
        >
          Back to stories
        </Link>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-8 text-center">
        <p className="text-gray-500 dark:text-gray-400 mb-4">Story not found</p>
        <Link
          to="/"
          className="text-hn-orange hover:underline"
        >
          Back to stories
        </Link>
      </div>
    );
  }

  const hostname = getHostname(story.url);
  
  // Build Algolia "past" search URL for this story title
  const pastUrl = `https://hn.algolia.com/?query=${encodeURIComponent(story.title)}&type=story&dateRange=all&sort=byDate&storyText=false&prefix&page=0`;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      {/* Story header - shown immediately */}
      <article className="mb-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2 leading-snug">
          {story.url ? (
            <a
              href={story.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-hn-orange transition-colors"
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

        {/* Meta: "16 points by idw 23 minutes ago | past | 52 comments" */}
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

      {/* Comments section - progressive loading */}
      <section>
        {commentsLoading && !comments ? (
          <CommentsSkeleton />
        ) : (
          <CommentTree comments={comments || []} />
        )}
      </section>
    </div>
  );
}

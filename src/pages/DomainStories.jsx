import { useParams } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { useInView } from 'react-intersection-observer';
import { StoryCard, Spinner, StoryCardSkeletonList } from '../components';
import { ALGOLIA_API } from '../config/api';

export function DomainStories() {
  // Use wildcard param to capture paths like github.com/foo
  const params = useParams();
  const domain = params['*'] || '';
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  
  const { ref, inView } = useInView({
    threshold: 0,
    rootMargin: '200px',
  });

  const loadStories = useCallback(async (pageNum = 0, append = false) => {
    setLoading(true);
    setError(null);

    try {
      // Use Algolia search_by_date to find stories from this domain
      // - restrictSearchableAttributes=url: only search in URL field (not title/author)
      // - search_by_date endpoint: returns newest first, matching HN's /from behavior
      const url = `${ALGOLIA_API}/search_by_date?tags=story&query=${encodeURIComponent(domain)}&restrictSearchableAttributes=url&hitsPerPage=50&page=${pageNum}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch stories: ${response.status}`);
      }

      const data = await response.json();
      
      // Filter to only include stories actually from this domain/path
      // domain can be "github.com" or "github.com/foo"
      const domainStories = data.hits
        .filter(hit => {
          if (!hit.url) return false;
          try {
            const parsed = new URL(hit.url);
            const hostname = parsed.hostname.replace(/^www\./, '');
            const fullPath = hostname + parsed.pathname;
            
            // Check if URL starts with our domain filter
            // e.g., domain="github.com/microsoft" matches "github.com/microsoft/foo"
            return fullPath.startsWith(domain) || 
                   hostname === domain || 
                   hostname.endsWith(`.${domain}`);
          } catch {
            return false;
          }
        })
        .map(hit => ({
          id: parseInt(hit.objectID, 10),
          title: hit.title,
          url: hit.url,
          points: hit.points,
          author: hit.author,
          createdAt: hit.created_at_i * 1000,
          commentCount: hit.num_comments || 0,
        }));

      if (append) {
        // Deduplicate when appending
        setStories(prev => {
          const existingIds = new Set(prev.map(s => s.id));
          const newStories = domainStories.filter(s => !existingIds.has(s.id));
          return [...prev, ...newStories];
        });
      } else {
        setStories(domainStories);
      }

      setHasMore(data.page < data.nbPages - 1);
      setPage(pageNum);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    setStories([]);
    setPage(0);
    setHasMore(true);
    loadStories(0, false);
  }, [domain, loadStories]);

  // Load more when scrolling near bottom
  useEffect(() => {
    if (inView && !loading && hasMore) {
      loadStories(page + 1, true);
    }
  }, [inView, loading, hasMore, page, loadStories]);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      <div className="mb-4 pb-3 border-b border-gray-100 dark:border-gray-800">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Stories from {domain}
        </h1>
      </div>

      {stories.length === 0 && loading ? (
        <StoryCardSkeletonList count={12} />
      ) : error && stories.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-red-500 dark:text-red-400 mb-4">Failed to load stories: {error}</p>
          <button
            onClick={() => loadStories(0, false)}
            className="px-4 py-2 bg-hn-orange text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : stories.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-8">
          No stories found from {domain}
        </p>
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
              You&apos;ve reached the end
            </p>
          )}
        </>
      )}
    </div>
  );
}

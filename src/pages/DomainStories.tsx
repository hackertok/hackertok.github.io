import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { useInView } from 'react-intersection-observer';
import { StoryCard, Spinner, StoryCardSkeletonList } from '../components';
import { ALGOLIA_API } from '../config/api';
import { normalizeAlgoliaHit } from '../api/hn';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import type { StoryItem, AlgoliaSearchResponse } from '../types';

export function DomainStories() {
  // Use wildcard param to capture paths like github.com/foo
  const params = useParams();
  const domain = params['*'] ?? '';
  
  // Set document title to show which domain (falls back to default "HackerTok" when empty)
  useDocumentTitle(domain ? `Submissions from ${domain}` : undefined);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  
  const { ref, inView } = useInView({
    threshold: 0,
    rootMargin: '200px',
  });

  const loadItems = useCallback(async (pageNum = 0, append = false) => {
    setLoading(true);
    setError(null);

    try {
      // Use Algolia search_by_date to find items from this domain
      // - restrictSearchableAttributes=url: only search in URL field (not title/author)
      // - search_by_date endpoint: returns newest first, matching HN's /from behavior
      const url = `${ALGOLIA_API}/search_by_date?tags=story&query=${encodeURIComponent(domain)}&restrictSearchableAttributes=url&hitsPerPage=50&page=${pageNum}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch stories: ${response.status}`);
      }

      const data = await response.json() as AlgoliaSearchResponse;
      
      // Filter to only include stories actually from this domain/path
      // domain can be "github.com" or "github.com/foo"
      const domainStories: StoryItem[] = data.hits
        .filter((hit) => {
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
        .map(normalizeAlgoliaHit);

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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    if (!domain) return;
    setStories([]);
    setPage(0);
    setHasMore(true);
    void loadItems(0, false);
  }, [domain, loadItems]);

  // Load more when scrolling near bottom
  useEffect(() => {
    if (inView && !loading && hasMore) {
      void loadItems(page + 1, true);
    }
  }, [inView, loading, hasMore, page, loadItems]);

  if (!domain) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
        <div className="text-center py-8">
          <p className="text-destructive mb-4">No domain specified</p>
          <Link
            to="/"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent-hover transition-colors"
          >
            Return to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      {stories.length === 0 && loading ? (
        <StoryCardSkeletonList count={12} />
      ) : error && stories.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-destructive mb-4">Failed to load stories: {error}</p>
          <button
            onClick={() => loadItems(0, false)}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent-hover transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : stories.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">
          No stories found from {domain}
        </p>
      ) : (
        <>
          <div className="space-y-0 divide-y divide-border">
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
            <p className="text-center text-sm text-muted-foreground py-8">
              You&apos;ve reached the end
            </p>
          )}
        </>
      )}
    </div>
  );
}

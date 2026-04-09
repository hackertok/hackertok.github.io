import { useParams } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useInView } from 'react-intersection-observer';
import { StoryCard, Spinner, StoryCardSkeletonList, StateView } from '../components';
import { ALGOLIA_API } from '../config/api';
import { normalizeAlgoliaHit } from '../api/hn';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
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
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const { ref, inView } = useInView({
    threshold: 0,
    rootMargin: '200px',
  });

  const loadItems = useCallback(async (pageNum = 0, append = false) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      // Use Algolia search_by_date to find items from this domain
      // - restrictSearchableAttributes=url: only search in URL field (not title/author)
      // - search_by_date endpoint: returns newest first, matching HN's /from behavior
      const url = `${ALGOLIA_API}/search_by_date?tags=story&query=${encodeURIComponent(domain)}&restrictSearchableAttributes=url&hitsPerPage=50&page=${pageNum}`;
      const response = await fetch(url, { signal: controller.signal });
      
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
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [domain]);

  const { isOnline } = useNetworkStatus();
  const retryFn = useCallback(() => {
    if (stories.length === 0) void loadItems(0, false);
    else void loadItems(page + 1, true);
  }, [stories.length, page, loadItems]);
  const { isRetrying, resetRetry } = useAutoRetry({
    error,
    retryFn,
    isOnline,
    enabled: !!domain,
  });

  useEffect(() => {
    if (!domain) return;
    setStories([]);
    setPage(0);
    setHasMore(true);
    void loadItems(0, false);
    return () => abortControllerRef.current?.abort();
  }, [domain, loadItems]);

  // Load more when scrolling near bottom (don't auto-retry on error — user clicks Retry)
  useEffect(() => {
    if (inView && !loading && hasMore && !error) {
      void loadItems(page + 1, true);
    }
  }, [inView, loading, hasMore, page, loadItems, error]);

  if (!domain) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="not-found"
          title="No domain specified"
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
          title="Failed to load items"
          description={error}
          action={{ label: 'Try Again', onClick: () => { resetRetry(); void loadItems(0, false); } }}
          className="page-state-center"
        />
      ) : error && stories.length === 0 && isRetrying ? (
        <StoryCardSkeletonList count={12} />
      ) : stories.length === 0 ? (
        <StateView
          variant="empty"
          title={`No submissions found from "${domain}"`}
          className="page-state-center"
        />
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
            <StateView variant="end" className="flex flex-col items-center justify-center text-center pt-8" />
          )}

          {error && stories.length > 0 && !isRetrying && (
            <div className="pb-4">
              <StateView variant="error" compact description={error} action={{ label: 'Retry', onClick: () => { resetRetry(); void loadItems(page + 1, true); } }} className="flex items-center justify-center gap-3 py-4 text-center" />
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

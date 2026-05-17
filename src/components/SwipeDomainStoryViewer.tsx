import { useMemo } from 'react';
import {
  useDomainInfiniteStories,
  canonicalizeDomain,
  formatNoSubmissionsTitle,
} from '../hooks/useDomainInfiniteStories';
import { SwipeStoryViewerCore } from './SwipeStoryViewer';

interface SwipeDomainStoryViewerProps {
  domain: string;
  initialItemId?: string;
}

/**
 * Domain-backed swipe viewer. Canonicalizes the domain prop;
 * skips cross-section prefetch (only meaningful for main feeds).
 */
export function SwipeDomainStoryViewer({ domain, initialItemId }: SwipeDomainStoryViewerProps) {
  const canonical = canonicalizeDomain(domain);
  const { stories, loading, error, hasMore, loadMore } = useDomainInfiniteStories(canonical);

  const backState = useMemo(() => ({ fromDomain: canonical }), [canonical]);

  return (
    <SwipeStoryViewerCore
      stories={stories}
      loading={loading}
      error={error}
      hasMore={hasMore}
      loadMore={loadMore}
      initialItemId={initialItemId}
      backState={backState}
      titleFallback={`Submissions from ${canonical}`}
      emptyTitle={formatNoSubmissionsTitle(canonical)}
    />
  );
}

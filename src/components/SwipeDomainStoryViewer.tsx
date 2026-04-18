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
 * Domain-backed swipe viewer. Thin wrapper over {@link SwipeStoryViewerCore}
 * that sources data from `useDomainInfiniteStories(domain)`.
 *
 * Used on mobile for `/from/:domain` and for `/item/:id` arrivals whose
 * `location.state` carries `fromDomain`.
 *
 * Does not call `usePrefetchSections` — the cross-section warm-up is only
 * meaningful for the main feed tabs (top/best/show/ask), not for domain
 * filtering which has its own data source.
 *
 * Canonicalizes the raw `domain` prop once (matching the hook's internal
 * canonicalization) so `state.fromDomain`, `backHref`, and the user-visible
 * titles all agree on a single form regardless of how the URL was typed.
 * Without this, `/from/WWW.Foo.com/` would write `state.fromDomain` in its
 * non-canonical form, and the back link from a swiped-to item would point
 * at a non-canonical URL (functional because the hook canonicalizes
 * internally, but cosmetically divergent).
 */
export function SwipeDomainStoryViewer({ domain, initialItemId }: SwipeDomainStoryViewerProps) {
  const canonical = canonicalizeDomain(domain);
  const { stories, loading, error, hasMore, loadMore } = useDomainInfiniteStories(canonical);

  // Stable identity so SwipeStoryViewerCore's URL-sync effect does not re-run on every parent re-render.
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
      backHref={`/from/${canonical}`}
      titleFallback={`Submissions from ${canonical}`}
      emptyTitle={formatNoSubmissionsTitle(canonical)}
    />
  );
}

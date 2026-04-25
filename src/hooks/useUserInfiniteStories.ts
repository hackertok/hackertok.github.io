import { useState, useCallback, useRef, useEffect } from 'react';
import { ALGOLIA_API } from '../config/api';
import { normalizeAlgoliaHit } from '../api/hn';
import type { StoryItem, AlgoliaSearchResponse } from '../types';

const HITS_PER_PAGE = 50;

interface UserCacheEntry {
  stories: StoryItem[];
  page: number;
  hasMore: boolean;
  seenIds: Set<number>;
}

// Module-level cache survives route remounts (e.g. /submitted/:id → /item/:id → back)
// and bridges the desktop list view and mobile swipe view for the same user.
// See `useDomainInfiniteStories` for the same pattern; bounded only by the
// page lifetime.
const userStoriesCache = new Map<string, UserCacheEntry>();

/**
 * @internal Testing helper to reset the module-level cache between tests.
 */
export function __resetUserStoriesCacheForTests() {
  userStoriesCache.clear();
}

/**
 * @internal Testing helper exposing the module-level cache for assertions.
 */
export function __getUserStoriesCacheForTests() {
  return userStoriesCache;
}

/**
 * Empty-state title shown when a user has no submitted stories.
 * "by" instead of "from" because the subject is a person, not a host.
 * Centralized so the desktop list (`UserSubmissions`) and mobile swipe viewer
 * (`SwipeUserSubmissionsViewer`) render identical copy.
 */
export function formatNoUserSubmissionsTitle(username: string): string {
  return `No submissions found by "${username}"`;
}

/**
 * Infinite-scroll data source for a user's submitted stories.
 *
 * Algolia's `author_X` tag is an exact, server-side match on the author
 * field — unlike `useDomainInfiniteStories`'s URL substring search, every
 * hit is guaranteed to belong to the user. Consequences:
 * - No local URL filter is needed (and we don't want one — every hit is real).
 * - No `MAX_EMPTY_PAGES_COLD_START` cap is needed: if a user has zero stories,
 *   page 0 returns 0 hits, `nbPages` is 0, and `hasMore` flips to false on
 *   the first round-trip. There's no "noisy substring" loop to bound.
 *
 * Otherwise mirrors `useDomainInfiniteStories`: dedup across pages, version
 * counter for stale-response invalidation, module-level cache, and the
 * `prevUsername` derived-state pattern for prop changes.
 */
export function useUserInfiniteStories(username: string) {
  const initialCached = username ? userStoriesCache.get(username) : undefined;

  const [stories, setStories] = useState<StoryItem[]>(initialCached?.stories ?? []);
  const [loading, setLoading] = useState(!initialCached && !!username);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialCached?.hasMore ?? true);
  const [prevUsername, setPrevUsername] = useState(username);

  const nextPageRef = useRef(initialCached?.page ?? 0);
  const seenIdsRef = useRef<Set<number>>(new Set(initialCached?.seenIds ?? []));
  const versionRef = useRef(0);
  const inFlightRef = useRef(false);
  // Mirrors committed `stories`. See `useDomainInfiniteStories` for the
  // same rationale — keeps the cache write out of the setStories functional
  // updater (which StrictMode double-invokes in dev).
  const storiesRef = useRef<StoryItem[]>(initialCached?.stories ?? []);

  // Prop-derived state: reset when `username` changes without waiting for
  // an effect. https://react.dev/reference/react/useState#storing-information-from-previous-renders
  if (prevUsername !== username) {
    setPrevUsername(username);
    const newCached = username ? userStoriesCache.get(username) : undefined;
    const newStories = newCached?.stories ?? [];
    setStories(newStories);
    setLoading(!newCached && !!username);
    setError(null);
    setHasMore(newCached?.hasMore ?? true);
    nextPageRef.current = newCached?.page ?? 0;
    seenIdsRef.current = new Set(newCached?.seenIds ?? []);
    storiesRef.current = newStories;
    versionRef.current += 1;
    inFlightRef.current = false;
  }

  const loadMore = useCallback(async () => {
    if (!username || !hasMore || inFlightRef.current) return;
    inFlightRef.current = true;

    setLoading(true);
    setError(null);

    const currentVersion = versionRef.current;

    try {
      const pageToFetch = nextPageRef.current;
      // tags=story,author_X is an AND filter: only stories AND authored by X.
      // search_by_date returns chronological newest-first, matching HN's
      // /submitted ordering.
      const url = `${ALGOLIA_API}/search_by_date?tags=story,author_${encodeURIComponent(username)}&hitsPerPage=${HITS_PER_PAGE}&page=${pageToFetch}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch stories: ${response.status}`);
      }

      if (versionRef.current !== currentVersion) return;

      const data = (await response.json()) as AlgoliaSearchResponse;

      // Second staleness check: see `useDomainInfiniteStories` for why this
      // is needed even after the first one above.
      if (versionRef.current !== currentVersion) return;

      const userStories: StoryItem[] = data.hits.map(normalizeAlgoliaHit);

      // Dedup across pages (Algolia can return overlaps on paginated search_by_date)
      const uniqueStories = userStories.filter((s) => {
        if (seenIdsRef.current.has(s.id)) return false;
        seenIdsRef.current.add(s.id);
        return true;
      });

      const newPage = data.page + 1;
      nextPageRef.current = newPage;

      const newHasMore = data.page < data.nbPages - 1;
      setHasMore(newHasMore);

      // Compute the next list outside any functional updater so setStories stays
      // pure. `storiesRef` mirrors committed state and is safe to read here
      // because inFlightRef guards against concurrent loadMore runs.
      const updated = [...storiesRef.current, ...uniqueStories];
      storiesRef.current = updated;
      userStoriesCache.set(username, {
        stories: updated,
        page: newPage,
        hasMore: newHasMore,
        seenIds: new Set(seenIdsRef.current),
      });
      setStories(updated);
    } catch (err) {
      if (versionRef.current !== currentVersion) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (versionRef.current === currentVersion) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [username, hasMore]);

  // Kick off the first fetch when we have no stories for this user.
  // No cleanup/abort — version counter handles stale responses.
  useEffect(() => {
    if (!username) return;
    if (stories.length === 0 && !inFlightRef.current) {
      void loadMore();
    }
  }, [username, stories.length, loadMore]);

  const reset = useCallback(() => {
    versionRef.current += 1;
    inFlightRef.current = false;
    setStories([]);
    setLoading(!!username);
    setError(null);
    setHasMore(true);
    nextPageRef.current = 0;
    seenIdsRef.current = new Set();
    storiesRef.current = [];
    if (username) userStoriesCache.delete(username);
  }, [username]);

  return { stories, loading, error, hasMore, loadMore, reset } as const;
}

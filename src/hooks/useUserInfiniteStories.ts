import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
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

// Module-level in-memory cache (see useDomainInfiniteStories).
const userStoriesCache = new Map<string, UserCacheEntry>();

/**
 * @internal Testing helper to reset the module-level cache between tests.
 */
export function __resetUserStoriesCacheForTests() {
  userStoriesCache.clear();
}

/** @internal Exposes cache for test assertions. */
export function __getUserStoriesCacheForTests() {
  return userStoriesCache;
}

/** Centralized empty-state title for user submission pages. */
export function formatNoUserSubmissionsTitle(username: string): string {
  return `No submissions found by "${username}"`;
}

/**
 * Paginated user stories from Algolia (`author_X` tag, exact match).
 * No local filter needed — every hit belongs to the user.
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
  // Mirrors committed stories (keeps cache write out of setStories updater).
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
  }

  // Reset refs when `username` changes. useLayoutEffect runs synchronously
  // after commit, before any microtask — ensures versionRef is bumped
  // before a stale in-flight fetch can check it.
  useLayoutEffect(() => {
    const cached = username ? userStoriesCache.get(username) : undefined;
    nextPageRef.current = cached?.page ?? 0;
    seenIdsRef.current = new Set(cached?.seenIds ?? []);
    storiesRef.current = cached?.stories ?? [];
    versionRef.current += 1;
    inFlightRef.current = false;
  }, [username]);

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

      // Second staleness check (see useDomainInfiniteStories).
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

      // Compute outside updater to keep setStories pure (StrictMode-safe).
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
      throw err;
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
      void loadMore().catch(() => { /* error state set internally */ });
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

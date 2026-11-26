import { useState, useCallback, useRef, useEffect } from 'react';
import { ALGOLIA_API } from '../config/api';
import { normalizeAlgoliaHit } from '../api/hn';
import { algoliaPageParams, nextAlgoliaPage, type AlgoliaPageCursor } from '../utils/algoliaPaging';
import { errorMessage } from '../utils/errors';
import type { StoryItem, AlgoliaHit, AlgoliaSearchResponse } from '../types';

const HITS_PER_PAGE = 50;

interface AlgoliaStoriesCacheEntry {
  stories: StoryItem[];
  page: number;
  before?: number;
  hasMore: boolean;
  seenIds: Set<number>;
}

/** Module-level in-memory cache per key (survives remounts, not persisted). */
export type AlgoliaStoriesCache = Map<string, AlgoliaStoriesCacheEntry>;

export interface AlgoliaStoriesSource {
  cache: AlgoliaStoriesCache;
  /** `search_by_date` params for `key`, without the paging params. */
  query: (key: string) => string;
  /** Keeps only the hits that really match `key`. */
  accept?: (hit: AlgoliaHit, key: string) => boolean;
  /**
   * On a cold start (no story accepted yet), keep paging within one
   * `loadMore` until a page yields a story, giving up after this many empty
   * pages in a row. Unset: one page per call.
   */
  maxEmptyPagesColdStart?: number;
}

/**
 * Paginated stories from Algolia `search_by_date`, deduped across pages and
 * cached per `key`. `key` is fixed for the hook's lifetime: callers remount
 * (React `key`) to switch, so state never carries over between keys.
 */
export function useAlgoliaInfiniteStories(key: string, source: AlgoliaStoriesSource) {
  const initialCached = key ? source.cache.get(key) : undefined;

  const [stories, setStories] = useState<StoryItem[]>(initialCached?.stories ?? []);
  const [loading, setLoading] = useState(!initialCached && !!key);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialCached?.hasMore ?? true);

  const nextPageRef = useRef<AlgoliaPageCursor>({ page: initialCached?.page ?? 0, before: initialCached?.before });
  const seenIdsRef = useRef<Set<number>>(new Set(initialCached?.seenIds ?? []));
  // Bumped by `reset` so a response for the cleared list is dropped.
  const versionRef = useRef(0);
  const inFlightRef = useRef(false);
  const emptyPageStreakRef = useRef(0);
  // Mirrors committed `stories` state. Used so `loadMore` can compute the
  // next list and write the cache synchronously, without either
  // (a) adding `stories` to useCallback deps (causing spurious re-renders
  // in downstream effects) or (b) performing a side effect inside the
  // setStories functional updater (which StrictMode double-invokes in dev,
  // writing to the cache twice per load).
  const storiesRef = useRef<StoryItem[]>(initialCached?.stories ?? []);

  const loadMore = useCallback(async () => {
    if (!key || !hasMore || inFlightRef.current) return;
    inFlightRef.current = true;

    setLoading(true);
    setError(null);

    const currentVersion = versionRef.current;
    const { cache, query, accept, maxEmptyPagesColdStart } = source;

    try {
      let uniqueStories: StoryItem[];
      let newHasMore: boolean;
      // A cold start may page on until a story lands: see maxEmptyPagesColdStart.
      do {
        const pageToFetch = nextPageRef.current;
        const url = `${ALGOLIA_API}/search_by_date?${query(key)}&hitsPerPage=${HITS_PER_PAGE}${algoliaPageParams(pageToFetch)}`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch stories: ${response.status}`);
        }

        if (versionRef.current !== currentVersion) return;

        const data = (await response.json()) as AlgoliaSearchResponse;

        // Second staleness check: `reset` can run while the body parses.
        if (versionRef.current !== currentVersion) return;

        const hits = accept ? data.hits.filter((hit) => accept(hit, key)) : data.hits;

        // Dedup across pages (Algolia can return overlaps on paginated search_by_date)
        uniqueStories = hits.map(normalizeAlgoliaHit).filter((s) => {
          if (seenIdsRef.current.has(s.id)) return false;
          seenIdsRef.current.add(s.id);
          return true;
        });

        const nextPage = nextAlgoliaPage(data, HITS_PER_PAGE, pageToFetch);
        nextPageRef.current = nextPage ?? { ...pageToFetch, page: data.page + 1 };

        // Cold-start cap. Snapshot before the storiesRef update below so the
        // check reflects "had we shown anything before this fetch?", not "are
        // we showing anything after it?".
        const isColdStart = storiesRef.current.length === 0;
        if (uniqueStories.length === 0 && isColdStart) {
          emptyPageStreakRef.current += 1;
        } else {
          emptyPageStreakRef.current = 0;
        }
        const capReached =
          maxEmptyPagesColdStart !== undefined && emptyPageStreakRef.current >= maxEmptyPagesColdStart;
        newHasMore = nextPage !== null && !capReached;
      } while (
        maxEmptyPagesColdStart !== undefined &&
        uniqueStories.length === 0 &&
        storiesRef.current.length === 0 &&
        newHasMore
      );
      setHasMore(newHasMore);

      // Compute the next list outside any functional updater so setStories stays
      // pure (StrictMode double-invokes impure updaters). `storiesRef` mirrors
      // committed state and is safe to read here because inFlightRef guards
      // against concurrent loadMore runs.
      const updated = [...storiesRef.current, ...uniqueStories];
      storiesRef.current = updated;
      cache.set(key, {
        stories: updated,
        ...nextPageRef.current,
        hasMore: newHasMore,
        seenIds: new Set(seenIdsRef.current),
      });
      setStories(updated);
    } catch (err) {
      if (versionRef.current !== currentVersion) return;
      setError(errorMessage(err));
      throw err;
    } finally {
      // Only clear flags if this fetch is still the current version. After a
      // `reset`, a newer fetch may own inFlightRef and loading.
      if (versionRef.current === currentVersion) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [key, hasMore, source]);

  // Kick off the first fetch when we have no stories for this key.
  // No cleanup/abort — version counter handles stale responses, and aborting
  // on cleanup would break StrictMode (mount → abort → skip-because-inFlight).
  useEffect(() => {
    if (!key) return;
    if (stories.length === 0 && !inFlightRef.current) {
      void loadMore().catch(() => { /* error state set internally */ });
    }
  }, [key, stories.length, loadMore]);

  const reset = useCallback(() => {
    versionRef.current += 1;
    inFlightRef.current = false;
    setStories([]);
    setLoading(!!key);
    setError(null);
    setHasMore(true);
    nextPageRef.current = { page: 0 };
    seenIdsRef.current = new Set();
    storiesRef.current = [];
    emptyPageStreakRef.current = 0;
    if (key) source.cache.delete(key);
  }, [key, source]);

  return { stories, loading, error, hasMore, loadMore, reset } as const;
}

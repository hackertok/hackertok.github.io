import { useState, useCallback, useRef, useEffect } from 'react';
import { ALGOLIA_API } from '../config/api';
import { normalizeAlgoliaHit } from '../api/hn';
import type { StoryItem, AlgoliaSearchResponse } from '../types';

const HITS_PER_PAGE = 50;
// On a cold start (no story has been accepted yet), stop after this many
// consecutive pages whose hits all fail the host filter. Algolia's URL search
// is tokenized and substring-prefix-greedy, so a query like `/from/microsoft`
// surfaces hundreds of `*.com` URLs containing "microsoft" in the path —
// none of which match the strict host filter. Without a cap, the swipe view's
// prefetch effect re-calls `loadMore` every time `loading` flips, producing a
// 4–10s skeleton↔empty-state flicker before Algolia's `nbPages` is exhausted.
// Only applies while `storiesRef.current.length === 0`; once any real hit
// lands, deep pagination is unbounded so sparse-but-real domains aren't trimmed.
const MAX_EMPTY_PAGES_COLD_START = 3;

interface DomainCacheEntry {
  stories: StoryItem[];
  page: number;
  hasMore: boolean;
  seenIds: Set<number>;
}

// Module-level in-memory cache (survives remounts, not persisted).
const domainCache = new Map<string, DomainCacheEntry>();

/**
 * @internal Testing helper to reset the module-level cache between tests.
 */
export function __resetDomainCacheForTests() {
  domainCache.clear();
}

/** @internal Exposes cache for test assertions. */
export function __getDomainCacheForTests() {
  return domainCache;
}

/**
 * Canonicalizes a domain: lowercase, strip trailing `/` and `.`,
 * strip leading `www.`. Idempotent so double-canonicalization is safe.
 */
export function canonicalizeDomain(rawDomain: string): string {
  return rawDomain
    .replace(/[/.]+$/, '')
    .replace(/^(www\.)+/i, '')
    .toLowerCase();
}

/** Centralized empty-state title for domain pages. */
export function formatNoSubmissionsTitle(domain: string): string {
  return `No submissions found from "${domain}"`;
}

/**
 * Paginated domain stories from Algolia URL search.
 * Dedupes, invalidates stale responses, and caches at module level.
 */
export function useDomainInfiniteStories(rawDomain: string) {
  // Canonicalize at entry so cache key, Algolia query, and filter all key off
  // the same form. See `canonicalizeDomain` for the list of normalizations.
  const domain = canonicalizeDomain(rawDomain);

  const initialCached = domain ? domainCache.get(domain) : undefined;

  const [stories, setStories] = useState<StoryItem[]>(initialCached?.stories ?? []);
  const [loading, setLoading] = useState(!initialCached && !!domain);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialCached?.hasMore ?? true);
  const [prevDomain, setPrevDomain] = useState(domain);

  const nextPageRef = useRef(initialCached?.page ?? 0);
  const seenIdsRef = useRef<Set<number>>(new Set(initialCached?.seenIds ?? []));
  const versionRef = useRef(0);
  const inFlightRef = useRef(false);
  const emptyPageStreakRef = useRef(0);
  // Mirrors committed `stories` state. Used so `loadMore` can compute the
  // next list and write the domain cache synchronously, without either
  // (a) adding `stories` to useCallback deps (causing spurious re-renders
  // in downstream effects) or (b) performing a side effect inside the
  // setStories functional updater (which StrictMode double-invokes in dev,
  // writing to the cache twice per load).
  const storiesRef = useRef<StoryItem[]>(initialCached?.stories ?? []);

  // React pattern for prop-derived state: reset when `domain` changes
  // without waiting for an effect. This runs during render and React
  // re-renders with the new state before committing.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  if (prevDomain !== domain) {
    setPrevDomain(domain);
    const newCached = domain ? domainCache.get(domain) : undefined;
    const newStories = newCached?.stories ?? [];
    setStories(newStories);
    setLoading(!newCached && !!domain);
    setError(null);
    setHasMore(newCached?.hasMore ?? true);
    nextPageRef.current = newCached?.page ?? 0;
    seenIdsRef.current = new Set(newCached?.seenIds ?? []);
    storiesRef.current = newStories;
    versionRef.current += 1;
    inFlightRef.current = false;
    emptyPageStreakRef.current = 0;
  }

  const loadMore = useCallback(async () => {
    if (!domain || !hasMore || inFlightRef.current) return;
    inFlightRef.current = true;

    setLoading(true);
    setError(null);

    const currentVersion = versionRef.current;

    try {
      const pageToFetch = nextPageRef.current;
      const url = `${ALGOLIA_API}/search_by_date?tags=story&query=${encodeURIComponent(domain)}&restrictSearchableAttributes=url&hitsPerPage=${HITS_PER_PAGE}&page=${pageToFetch}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch stories: ${response.status}`);
      }

      if (versionRef.current !== currentVersion) return;

      const data = (await response.json()) as AlgoliaSearchResponse;

      // Second staleness check: `await response.json()` yields; the domain
      // can change (and bump versionRef) during parse. Without this, the
      // closure-captured `domain` would cause `domainCache.set(domain, ...)`
      // to clobber the old domain's entry with partial data, and the
      // appended stories would land on the new domain's state.
      if (versionRef.current !== currentVersion) return;

      // `domain` is a hostname (e.g. "github.com") OR a hostname+path
      // (e.g. "github.com/microsoft"). Algolia's URL search can surface hits
      // where the domain appears elsewhere in the URL (other host, path
      // segment, query string), so verify locally. The match must require a
      // `/` boundary after the domain — a bare `startsWith(domain)` would let
      // `github.com.evil.com` surface under `/from/github.com`.
      //
      // Only http(s) URLs are accepted: defense-in-depth against
      // `javascript:`/`data:`/`file:` URLs, which `new URL` happily parses
      // with a `hostname` that would otherwise pass the host check (e.g.
      // `javascript://github.com/%0Aalert(1)` parses with hostname=github.com).
      const domainSlashPrefix = `${domain}/`;
      const hostDotSuffix = `.${domain}`;
      const domainStories: StoryItem[] = data.hits
        .filter((hit) => {
          if (!hit.url) return false;
          try {
            const parsed = new URL(hit.url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
            // hostname is already lowercase per WHATWG; pathname preserves
            // case, so lowercase the full string for case-insensitive match
            // against the (already-lowercased) `domain`. Trailing DNS dot is
            // stripped for the same reason as the domain prop.
            const hostname = parsed.hostname.replace(/^www\./, '').replace(/\.$/, '');
            const fullPath = (hostname + parsed.pathname).toLowerCase();
            return (
              fullPath === domain ||
              fullPath.startsWith(domainSlashPrefix) ||
              hostname.endsWith(hostDotSuffix)
            );
          } catch {
            return false;
          }
        })
        .map(normalizeAlgoliaHit);

      // Dedup across pages (Algolia can return overlaps on paginated search_by_date)
      const uniqueStories = domainStories.filter((s) => {
        if (seenIdsRef.current.has(s.id)) return false;
        seenIdsRef.current.add(s.id);
        return true;
      });

      const newPage = data.page + 1;
      nextPageRef.current = newPage;

      // Cold-start cap: see MAX_EMPTY_PAGES_COLD_START. Snapshot before the
      // storiesRef update below so the check reflects "had we shown anything
      // before this fetch?", not "are we showing anything after it?".
      const isColdStart = storiesRef.current.length === 0;
      if (uniqueStories.length === 0 && isColdStart) {
        emptyPageStreakRef.current += 1;
      } else {
        emptyPageStreakRef.current = 0;
      }
      const algoliaHasMore = data.page < data.nbPages - 1;
      const capReached = emptyPageStreakRef.current >= MAX_EMPTY_PAGES_COLD_START;
      const newHasMore = algoliaHasMore && !capReached;
      setHasMore(newHasMore);

      // Compute the next list outside any functional updater so setStories stays
      // pure (StrictMode double-invokes impure updaters). `storiesRef` mirrors
      // committed state and is safe to read here because inFlightRef guards
      // against concurrent loadMore runs for the same domain.
      const updated = [...storiesRef.current, ...uniqueStories];
      storiesRef.current = updated;
      domainCache.set(domain, {
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
      // Only clear flags if this fetch is still the current version.
      // If domain changed mid-flight, the reset block already cleared them and
      // started a new fetch — we must not clobber that fetch's inFlightRef.
      if (versionRef.current === currentVersion) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [domain, hasMore]);

  // Kick off the first fetch when we have no stories for this domain.
  // No cleanup/abort — version counter handles stale responses, and aborting
  // on cleanup would break StrictMode (mount → abort → skip-because-inFlight).
  useEffect(() => {
    if (!domain) return;
    if (stories.length === 0 && !inFlightRef.current) {
      void loadMore().catch(() => { /* error state set internally */ });
    }
  }, [domain, stories.length, loadMore]);

  const reset = useCallback(() => {
    versionRef.current += 1;
    inFlightRef.current = false;
    setStories([]);
    setLoading(!!domain);
    setError(null);
    setHasMore(true);
    nextPageRef.current = 0;
    seenIdsRef.current = new Set();
    storiesRef.current = [];
    emptyPageStreakRef.current = 0;
    if (domain) domainCache.delete(domain);
  }, [domain]);

  return { stories, loading, error, hasMore, loadMore, reset } as const;
}

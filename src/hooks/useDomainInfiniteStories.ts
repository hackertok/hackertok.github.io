import {
  useAlgoliaInfiniteStories,
  type AlgoliaStoriesCache,
  type AlgoliaStoriesSource,
} from './useAlgoliaInfiniteStories';
import type { AlgoliaHit } from '../types';

// On a cold start (no story has been accepted yet), `loadMore` keeps paging
// within one call until a page yields a story, and gives up after this many
// consecutive pages whose hits all fail the host filter. Algolia's URL search
// is tokenized and substring-prefix-greedy, so a query like `/from/microsoft`
// surfaces hundreds of `*.com` URLs containing "microsoft" in the path —
// none of which match the strict host filter. Paging inside the call matters
// because nothing else asks for page 2: the desktop list has no sentinel to
// scroll while it's empty, so a first page of noise read as "no submissions"
// even when the next page had them. The cap bounds noisy queries.
// Only applies while no story has been accepted; once any real hit lands,
// deep pagination is unbounded so sparse-but-real domains aren't trimmed.
const MAX_EMPTY_PAGES_COLD_START = 3;

const domainCache: AlgoliaStoriesCache = new Map();

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
function isFromDomain(hit: AlgoliaHit, domain: string): boolean {
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
      fullPath.startsWith(`${domain}/`) ||
      hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

const domainSource: AlgoliaStoriesSource = {
  cache: domainCache,
  query: (domain) => `tags=story&query=${encodeURIComponent(domain)}&restrictSearchableAttributes=url`,
  accept: isFromDomain,
  maxEmptyPagesColdStart: MAX_EMPTY_PAGES_COLD_START,
};

/**
 * Paginated domain stories from Algolia URL search, filtered to the domain.
 * Remount (React `key`) to change domain.
 */
export function useDomainInfiniteStories(rawDomain: string) {
  // Canonicalize at entry so cache key, Algolia query, and filter all key off
  // the same form. See `canonicalizeDomain` for the list of normalizations.
  return useAlgoliaInfiniteStories(canonicalizeDomain(rawDomain), domainSource);
}

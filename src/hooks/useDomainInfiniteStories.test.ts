import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { StrictMode } from 'react';
import {
  useDomainInfiniteStories,
  canonicalizeDomain,
  __resetDomainCacheForTests,
  __getDomainCacheForTests,
} from './useDomainInfiniteStories';

// --- Test helpers ---

function body(domain: string, ids: number[], page = 0, nbPages = 1) {
  return {
    hits: ids.map((id) => ({
      objectID: String(id),
      title: `Story ${id} from ${domain}`,
      url: `https://${domain}/${id}`,
      author: 'tester',
      points: 100,
      created_at_i: Math.floor(Date.now() / 1000),
      num_comments: 1,
      _tags: ['story'],
    })),
    nbHits: ids.length,
    nbPages,
    page,
    hitsPerPage: 50,
  };
}

/**
 * Builds an Algolia response page where every hit's URL host fails the
 * filter for `targetDomain` — Algolia returned hits, but they're "noise"
 * (e.g. the domain string appears in the path of an unrelated URL). Used
 * to simulate the loop scenario the cold-start cap is meant to bound.
 */
function noiseBody(targetDomain: string, count: number, page = 0, nbPages = 1) {
  return {
    hits: Array.from({ length: count }, (_, i) => ({
      objectID: String(page * 1000 + i + 100000),
      title: `Noise ${i}`,
      // hostname is `unrelated.example` (not `targetDomain`, not a subdomain
      // of it); the path mentions `targetDomain` so a naive substring match
      // would falsely accept these. The strict host filter rejects all.
      url: `https://unrelated.example/path/${targetDomain}/${i}`,
      author: 'tester',
      points: 100,
      created_at_i: Math.floor(Date.now() / 1000),
      num_comments: 0,
      _tags: ['story'],
    })),
    nbHits: count,
    nbPages,
    page,
    hitsPerPage: 50,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * A controllable "Response" where json() resolves on demand. Lets us simulate
 * the window between the version check after `await fetch()` and the state
 * mutations that happen after `await response.json()`.
 */
function fakeResponse<T>(jsonDeferred: Deferred<T>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => jsonDeferred.promise as unknown as Promise<unknown>,
  } as unknown as Response;
}

/** Extracts the URL string from a `fetch` mock's input argument. */
function fetchInputToUrl(input: RequestInfo | URL | undefined): string {
  if (!input) return '';
  if (input instanceof URL) return input.href;
  if (typeof input === 'string') return input;
  return input.url;
}

/**
 * Mounts the hook for `firstDomain`, lets the fetch complete, unmounts, then
 * remounts for `secondDomain` and asserts the second mount hit the
 * module-level cache synchronously: `loading=false` on first render, same
 * stories, and no additional fetch. Used to pin the invariants that let
 * `canonicalizeDomain` variants (trailing slash, `www.` prefix, etc.) share
 * a single cache entry across navigation.
 *
 * The mock URLs are generated from `canonicalizeDomain(firstDomain)` so hits
 * pass the hook's URL filter regardless of which domain the caller picks —
 * the helper works for any `firstDomain` as long as both inputs canonicalize
 * to the same key.
 */
async function expectRemountHitsCache(firstDomain: string, secondDomain: string) {
  const canonicalKey = canonicalizeDomain(firstDomain);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body(canonicalKey, [1, 2, 3]))),
  );

  const first = renderHook(() => useDomainInfiniteStories(firstDomain));
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  expect(fetchSpy).toHaveBeenCalledTimes(1);

  first.unmount();
  fetchSpy.mockClear();

  const second = renderHook(() => useDomainInfiniteStories(secondDomain));

  expect(second.result.current.loading).toBe(false);
  expect(second.result.current.stories.map((s) => s.id)).toEqual([1, 2, 3]);

  // Drain microtasks so the auto-load effect has a chance to run; it must
  // skip because `stories.length > 0`.
  await Promise.resolve();
  await Promise.resolve();
  expect(fetchSpy).not.toHaveBeenCalled();
}

describe('canonicalizeDomain', () => {
  // Contract surface for SwipeDomainStoryViewer and DomainStories, which
  // call this to keep `state.fromDomain`, titles, and back-hrefs aligned
  // with the hook's internal cache key. Any behavior change here should
  // be reflected in both wrappers.
  it.each([
    ['already-canonical form is a no-op', 'github.com', 'github.com'],
    ['lowercases uppercase variants', 'GitHub.COM', 'github.com'],
    ['strips trailing slash', 'github.com/', 'github.com'],
    ['strips trailing DNS dot', 'github.com.', 'github.com'],
    ['strips leading www.', 'www.github.com', 'github.com'],
    ['strips leading Www. (case-insensitive)', 'Www.GitHub.com', 'github.com'],
    [
      'applies all normalizations together',
      'WWW.GitHub.COM./',
      'github.com',
    ],
    ['preserves hostname+path form (only the host gets trimmed)', 'github.com/Microsoft', 'github.com/microsoft'],
    ['does not collapse www-lookalike prefixes', 'www2.example.com', 'www2.example.com'],
    ['does not strip an interior www', 'api.www.example.com', 'api.www.example.com'],
    ['passes empty string through', '', ''],
    // Interleaved/repeated trailing crud is collapsed in one pass. Without
    // this the helper strips only one `/` and one `.`, which leaves residue
    // for inputs that mix them (e.g. `foo.com/.` → `foo.com/` on the old
    // single-strip pipeline).
    ['collapses interleaved trailing dot+slash (./)', 'github.com./', 'github.com'],
    ['collapses interleaved trailing slash+dot (/.)', 'github.com/.', 'github.com'],
    ['collapses multiple trailing dots', 'github.com..', 'github.com'],
    ['collapses multiple trailing slashes', 'github.com//', 'github.com'],
    ['collapses arbitrary trailing run of dots and slashes', 'github.com...//.', 'github.com'],
    // Multi-level www. prefixes are fully stripped. This closes a latent
    // drift between wrappers (one canonicalization pass) and the hook
    // (which re-canonicalizes its input) for `www.www.X`-style inputs.
    ['collapses doubled leading www.', 'www.www.example.com', 'example.com'],
    ['collapses triple leading www.', 'www.www.www.example.com', 'example.com'],
    ['collapses mixed-case doubled leading www. (case-insensitive)', 'WWW.Www.Example.COM', 'example.com'],
    ['preserves www-lookalike after a legitimate www strip', 'www.www2.example.com', 'www2.example.com'],
  ])('%s', (_label, input, expected) => {
    expect(canonicalizeDomain(input)).toBe(expected);
  });

  // Idempotency is load-bearing: the hook canonicalizes its `rawDomain`
  // argument internally, and wrappers canonicalize before passing. Without
  // this guarantee, `state.fromDomain` (written from the wrapper's one-pass
  // form) would drift from the hook's cache key (written from the two-pass
  // form) for any input where a second pass produces a different result.
  it.each([
    ['github.com'],
    ['GitHub.COM'],
    ['github.com/'],
    ['github.com.'],
    ['www.github.com'],
    ['Www.GitHub.com'],
    ['WWW.GitHub.COM./'],
    ['github.com/Microsoft'],
    ['www2.example.com'],
    ['api.www.example.com'],
    [''],
    // The inputs that originally motivated the idempotency fix:
    ['www.www.example.com'],
    ['www.www.www.example.com'],
    ['github.com./'],
    ['github.com/.'],
    ['github.com..'],
    ['github.com...//.'],
  ])('is idempotent for %s', (input) => {
    const once = canonicalizeDomain(input);
    const twice = canonicalizeDomain(once);
    expect(twice).toBe(once);
  });
});

describe('useDomainInfiniteStories', () => {
  beforeEach(() => {
    __resetDomainCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads stories for a domain on mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body('alpha.com', [1, 2, 3]))),
    );

    const { result } = renderHook(() => useDomainInfiniteStories('alpha.com'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.stories.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  describe('domain-change staleness', () => {
    it('discards stale response that resolves AFTER a rerender to a new domain', async () => {
      // Scenario: user navigates to beta BEFORE alpha's fetch() resolves.
      // The first version check (after await fetch()) must catch it.
      const deferredByDomain = new Map<string, Deferred<Response>>();

      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = fetchInputToUrl(input);
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        const domain = decodeURIComponent(params.get('query') ?? '');
        const d = defer<Response>();
        deferredByDomain.set(domain, d);
        return d.promise;
      });

      const { result, rerender } = renderHook(
        ({ domain }: { domain: string }) => useDomainInfiniteStories(domain),
        { initialProps: { domain: 'alpha.com' } },
      );

      await waitFor(() => expect(deferredByDomain.has('alpha.com')).toBe(true));

      rerender({ domain: 'beta.com' });
      await waitFor(() => expect(deferredByDomain.has('beta.com')).toBe(true));

      await act(async () => {
        deferredByDomain.get('alpha.com')!.resolve(
          new Response(JSON.stringify(body('alpha.com', [1, 2, 3]))),
        );
        deferredByDomain.get('beta.com')!.resolve(
          new Response(JSON.stringify(body('beta.com', [100, 101]))),
        );
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.stories.map((s) => s.id)).toEqual([100, 101]);
    });

    it('discards stale response whose json() resolves AFTER a rerender to a new domain', async () => {
      // Scenario: alpha.fetch() has resolved and passed the first version
      // check; we're inside `await response.json()` when the rerender happens.
      // This is the case the single pre-json check would miss; a second check
      // after json() is required.
      const fetchDeferred = new Map<string, Deferred<Response>>();
      const jsonDeferred = new Map<string, Deferred<unknown>>();

      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = fetchInputToUrl(input);
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        const domain = decodeURIComponent(params.get('query') ?? '');
        const fd = defer<Response>();
        const jd = defer<unknown>();
        fetchDeferred.set(domain, fd);
        jsonDeferred.set(domain, jd);
        return fd.promise;
      });

      const { result, rerender } = renderHook(
        ({ domain }: { domain: string }) => useDomainInfiniteStories(domain),
        { initialProps: { domain: 'alpha.com' } },
      );

      await waitFor(() => expect(fetchDeferred.has('alpha.com')).toBe(true));

      // Alpha's fetch resolves but json() is still pending.
      await act(async () => {
        fetchDeferred.get('alpha.com')!.resolve(fakeResponse(jsonDeferred.get('alpha.com')!));
        await Promise.resolve();
        await Promise.resolve();
      });

      // Rerender to beta while alpha's json() is pending.
      rerender({ domain: 'beta.com' });
      await waitFor(() => expect(fetchDeferred.has('beta.com')).toBe(true));

      // Beta's fetch resolves cleanly.
      await act(async () => {
        fetchDeferred.get('beta.com')!.resolve(
          new Response(JSON.stringify(body('beta.com', [100, 101]))),
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Alpha's stale json() finally resolves — the second version check
      // must discard it.
      await act(async () => {
        jsonDeferred.get('alpha.com')!.resolve(body('alpha.com', [1, 2, 3]));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.stories.map((s) => s.id)).toEqual([100, 101]);
    });
  });

  describe('updater purity', () => {
    it('writes the domain cache exactly once per successful load under StrictMode', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(body('alpha.com', [1, 2, 3]))),
      );

      // Instrument Map.prototype.set but only count calls on the domainCache
      // instance (React internals also use Maps). If the cache write happens
      // inside a setStories functional updater, StrictMode invokes it twice
      // in dev and we'd see count === 2. After fix #2 (lift the write out of
      // the updater), count === 1.
      const cache = __getDomainCacheForTests();
      const originalSet = Map.prototype.set;
      let setCount = 0;
      Map.prototype.set = function (this: Map<unknown, unknown>, key, value) {
        if (this === cache) setCount += 1;
        return originalSet.call(this, key, value);
      };

      try {
        const { result } = renderHook(() => useDomainInfiniteStories('alpha.com'), {
          wrapper: StrictMode,
        });
        await waitFor(() => expect(result.current.stories.length).toBe(3));
      } finally {
        Map.prototype.set = originalSet;
      }

      expect(setCount).toBe(1);
    });
  });

  describe('cache', () => {
    // The module-level cache is what makes the desktop list ↔ mobile swipe
    // handoff feel instant, so the second mount must already have the stories
    // and `loading=false` without a new fetch.
    it('returns cached stories synchronously on remount and skips the fetch', async () => {
      await expectRemountHitsCache('alpha.com', 'alpha.com');
    });

    // Direct hits like `/from/alpha.com/` produce a slash-suffixed `domain`
    // prop via the wildcard route. The hook must normalize at entry so that
    // mount and remount land on the same cache entry — otherwise the slash
    // variant re-fetches and flashes `loading=true` despite identical data.
    it('shares the cache across trailing-slash variants of the same domain', async () => {
      await expectRemountHitsCache('alpha.com', 'alpha.com/');
    });

    // Direct hits like `/from/www.alpha.com` share the canonical form
    // `alpha.com` with `/from/alpha.com`; the second mount must hit the
    // cache and skip the fetch (same invariant as the trailing-slash test).
    it('shares the cache across www.-prefixed variants of the same domain', async () => {
      await expectRemountHitsCache('alpha.com', 'www.alpha.com');
    });
  });

  describe('error handling', () => {
    it('sets error on fetch rejection, releases inFlight, and supports manual retry', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(body('alpha.com', [1, 2]))),
        );

      const { result } = renderHook(() => useDomainInfiniteStories('alpha.com'));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('network down');
      expect(result.current.stories).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // The retry path exists only if `inFlightRef` is released in the finally
      // block of `loadMore`. If a future change forgets to release it, the
      // user-facing "Try Again" button silently no-ops.
      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.stories.map((s) => s.id)).toEqual([1, 2]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('sets error when the response status is not ok', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Service Unavailable', { status: 503 }),
      );

      const { result } = renderHook(() => useDomainInfiniteStories('alpha.com'));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toMatch(/503/);
      expect(result.current.stories).toEqual([]);
    });

    // `nextPageRef.current = newPage` advances ONLY in the success branch of
    // loadMore. If a future refactor moves it before the error checks, a retry
    // after a mid-pagination error would silently skip the failed page. This
    // test pins both the retried page index and the resulting story list.
    it('retries the same page after a mid-pagination error (does not skip ahead)', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify(body('alpha.com', [1, 2], 0, 3))),
        )
        .mockRejectedValueOnce(new Error('flaky'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(body('alpha.com', [3, 4], 1, 3))),
        );

      const { result } = renderHook(() => useDomainInfiniteStories('alpha.com'));
      await waitFor(() =>
        expect(result.current.stories.map((s) => s.id)).toEqual([1, 2]),
      );

      await act(async () => {
        await result.current.loadMore().catch(() => { /* error set internally */ });
      });
      await waitFor(() => expect(result.current.error).toBe('flaky'));

      await act(async () => {
        await result.current.loadMore().catch(() => { /* error set internally */ });
      });
      await waitFor(() =>
        expect(result.current.stories.map((s) => s.id)).toEqual([1, 2, 3, 4]),
      );

      // Load-bearing: the third request must target page=1 (the page that
      // just failed), not page=2.
      const calls = fetchSpy.mock.calls;
      const lastUrl = fetchInputToUrl(calls[calls.length - 1]?.[0]);
      expect(lastUrl).toMatch(/[?&]page=1(&|$)/);
    });
  });

  describe('URL filtering', () => {
    function hitsWith(urls: (string | null | undefined)[]) {
      return {
        hits: urls.map((url, i) => ({
          objectID: String(i + 1),
          title: `t${i + 1}`,
          url,
          author: 'a',
          points: 0,
          created_at_i: 0,
          num_comments: 0,
          _tags: ['story'],
        })),
        nbHits: urls.length,
        nbPages: 1,
        page: 0,
        hitsPerPage: 50,
      };
    }

    async function loadDomain(
      domain: string,
      urls: (string | null | undefined)[],
    ) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(hitsWith(urls))),
      );
      const { result } = renderHook(() => useDomainInfiniteStories(domain));
      await waitFor(() => expect(result.current.loading).toBe(false));
      return result.current.stories.map((s) => s.id);
    }

    it('matches subdomain when querying the parent domain', async () => {
      const ids = await loadDomain('example.com', [
        'https://blog.example.com/post',
      ]);
      expect(ids).toEqual([1]);
    });

    it('matches www-prefixed hostname against the bare domain', async () => {
      // hostname is stripped of `www.` before comparison
      const ids = await loadDomain('example.com', ['https://www.example.com/']);
      expect(ids).toEqual([1]);
    });

    it('matches hostname+path queries (e.g. github.com/microsoft)', async () => {
      const ids = await loadDomain('github.com/microsoft', [
        'https://github.com/microsoft/typescript',
      ]);
      expect(ids).toEqual([1]);
    });

    it('excludes hits whose URL fails to parse', async () => {
      const ids = await loadDomain('example.com', ['not-a-url']);
      expect(ids).toEqual([]);
    });

    it('excludes hits where the domain appears only in path or query', async () => {
      const ids = await loadDomain('example.com', [
        'https://other.com/example.com/foo',
        'https://other.com/?ref=example.com',
      ]);
      expect(ids).toEqual([]);
    });

    it('excludes hits with missing URL', async () => {
      const ids = await loadDomain('example.com', [null, undefined]);
      expect(ids).toEqual([]);
    });

    // Regression: a previous filter used `fullPath.startsWith(domain)`, which
    // matched any host that merely *began* with the domain text. This let
    // attacker-shaped URLs like `github.com.evil.com/...` surface under the
    // `/from/github.com` page (a misattribution / phishing-adjacent UX bug).
    it('excludes hits whose host has the domain as a prefix but is not a subdomain', async () => {
      const ids = await loadDomain('github.com', [
        'https://github.com.evil.com/foo',
        'https://github.commons.org/foo',
      ]);
      expect(ids).toEqual([]);
    });

    // Regression: same root cause as above, but at the path-segment level.
    // `github.com/microsoft` previously matched `github.com/microsofts/...`
    // because `startsWith` did not require a `/` boundary after the domain.
    it('excludes hits where a path-segment merely starts with the domain path', async () => {
      const ids = await loadDomain('github.com/microsoft', [
        'https://github.com/microsofts/foo',
      ]);
      expect(ids).toEqual([]);
    });

    // Defends against a regression in the fix itself: the corrected matcher
    // would never match `github.com/foo` against a slash-suffixed `github.com/`
    // domain prop without explicit trailing-slash normalization. Direct URLs
    // like `/from/github.com/` produce that prop value via the wildcard route.
    it('treats a trailing slash on the domain prop as equivalent to no slash', async () => {
      const ids = await loadDomain('github.com/', ['https://github.com/foo']);
      expect(ids).toEqual([1]);
    });

    // Regression: URL.hostname is always lowercase per WHATWG, but route
    // params preserve case. Without lowercasing the domain prop, a route
    // like `/from/Github.com` would return Algolia hits but every hostname
    // comparison would mismatch and the user would see "No submissions found".
    it('treats the domain prop as case-insensitive', async () => {
      const ids = await loadDomain('Github.com', ['https://github.com/foo']);
      expect(ids).toEqual([1]);
    });

    // Hostname+path domains preserve path case in URL parsing, so the
    // comparison itself must be case-insensitive (lowercase both sides).
    it('matches hostname+path domains case-insensitively', async () => {
      const ids = await loadDomain('GitHub.com/Microsoft', [
        'https://github.com/Microsoft/typescript',
      ]);
      expect(ids).toEqual([1]);
    });

    // Trailing DNS dot is valid and `URL.hostname` preserves it. Without
    // stripping it, `https://github.com./foo` would never match a
    // `/from/github.com` route, and `/from/github.com.` would never match
    // any normal hit.
    it('treats trailing DNS dot as equivalent (URL side)', async () => {
      const ids = await loadDomain('github.com', ['https://github.com./foo']);
      expect(ids).toEqual([1]);
    });

    it('treats trailing DNS dot as equivalent (domain prop side)', async () => {
      const ids = await loadDomain('github.com.', ['https://github.com/foo']);
      expect(ids).toEqual([1]);
    });

    // Regression: the URL-hostname side strips `^www\.` before comparing.
    // Without mirroring the same strip on the domain prop, a route like
    // `/from/www.example.com` would never match a hit from `example.com`
    // (asymmetric — the URL "example.com" and the prop "www.example.com"
    // compare as different) nor even from `https://www.example.com`
    // (because the URL side strips its own `www.` before comparison but
    // the prop still has it). Users get "No submissions found" despite
    // legitimate matches existing.
    it('treats a www-prefixed domain prop as equivalent to the bare form', async () => {
      const ids = await loadDomain('www.example.com', [
        'https://example.com/foo',
      ]);
      expect(ids).toEqual([1]);
    });

    it('matches www-prefixed URL against a www-prefixed domain prop', async () => {
      const ids = await loadDomain('www.example.com', [
        'https://www.example.com/foo',
      ]);
      expect(ids).toEqual([1]);
    });

    it('canonicalizes www. prop case-insensitively (Www./WWW. variants)', async () => {
      // The strip is `^www\.` case-insensitive; `Www.Foo.com` should
      // canonicalize identically to `www.foo.com` → `foo.com`.
      const ids = await loadDomain('WWW.Example.com/', [
        'https://example.com/foo',
      ]);
      expect(ids).toEqual([1]);
    });

    // Guards against an over-eager strip: the `^www\.` anchor must require a
    // literal leading "www." — a domain like "www2.example.com" is a separate
    // host and should NOT collapse to `example.com`.
    it('does not strip www-lookalike prefixes (www2., ww., www-cdn.)', async () => {
      const ids = await loadDomain('www2.example.com', [
        'https://example.com/foo',
      ]);
      expect(ids).toEqual([]);
    });

    // Defense in depth: WHATWG `new URL` parses non-special schemes such
    // that `javascript://github.com/%0Aalert(1)` yields hostname=github.com.
    // Without the protocol allowlist, such hits would surface under
    // `/from/github.com`, and `<a href={story.url}>` clicks would execute
    // the JS payload (the underlying StoryCard hardening is a separate
    // concern; the filter rejects them as the immediate mitigation here).
    it('rejects non-http(s) schemes even when hostname matches', async () => {
      const ids = await loadDomain('github.com', [
        'javascript://github.com/%0Aalert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file://github.com/etc/passwd',
        'ftp://github.com/foo',
      ]);
      expect(ids).toEqual([]);
    });
  });

  describe('dedup across pages', () => {
    it('does not include the same story id twice when it appears on consecutive pages', async () => {
      // Algolia's search_by_date can return overlapping ids across pages; the
      // hook must skip ids it has already committed via `seenIdsRef`.
      let call = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        const page = call++;
        return Promise.resolve(
          new Response(
            JSON.stringify(
              page === 0
                ? body('example.com', [1, 2], 0, 2)
                : body('example.com', [2, 3], 1, 2),
            ),
          ),
        );
      });

      const { result } = renderHook(() =>
        useDomainInfiniteStories('example.com'),
      );

      await waitFor(() =>
        expect(result.current.stories.map((s) => s.id)).toEqual([1, 2]),
      );
      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.stories.map((s) => s.id)).toEqual([1, 2, 3]);
      expect(result.current.hasMore).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears state, removes the cache entry, and triggers a fresh fetch', async () => {
      // Two distinct payloads so we can prove the second fetch actually ran
      // (vs. picking up cached stories).
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify(body('alpha.com', [1, 2, 3]))),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(body('alpha.com', [10, 11]))),
        );

      const { result } = renderHook(() => useDomainInfiniteStories('alpha.com'));

      await waitFor(() => expect(result.current.stories.length).toBe(3));
      expect(__getDomainCacheForTests().has('alpha.com')).toBe(true);

      act(() => {
        result.current.reset();
      });

      // Cache entry is removed synchronously by `reset()`.
      expect(__getDomainCacheForTests().has('alpha.com')).toBe(false);

      // Auto-load effect re-fires (stories empty + inFlight false) and
      // repopulates state with the second payload.
      await waitFor(() =>
        expect(result.current.stories.map((s) => s.id)).toEqual([10, 11]),
      );
      expect(__getDomainCacheForTests().has('alpha.com')).toBe(true);
    });
  });

  describe('cold-start empty-page cap', () => {
    // The mobile swipe view's prefetch effect re-calls loadMore every time
    // `loading` flips while `mergedStories.length < 10`. On a noisy substring
    // query (e.g. `/from/microsoft` returning hundreds of `*.com` URLs that
    // all fail the host filter), this loops 5–20 sequential fetches before
    // Algolia's `nbPages` is exhausted, producing a multi-second skeleton↔
    // empty-state flicker. The cap halts the loop after 3 consecutive empty
    // pages while no story has been accepted yet.

    it('halts after 3 consecutive filter-rejected pages and caches the terminal state', async () => {
      let call = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        const page = call++;
        return Promise.resolve(
          new Response(JSON.stringify(noiseBody('target.com', 50, page, 10))),
        );
      });

      const { result } = renderHook(() => useDomainInfiniteStories('target.com'));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.stories).toEqual([]);
      expect(result.current.hasMore).toBe(true);
      expect(call).toBe(1);

      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.hasMore).toBe(true);
      expect(call).toBe(2);

      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.hasMore).toBe(false);
      expect(result.current.stories).toEqual([]);
      expect(call).toBe(3);

      // The `!hasMore` guard in loadMore prevents any further fetches.
      await act(async () => {
        await result.current.loadMore();
      });
      expect(call).toBe(3);

      // Cached state reflects the cap — a remount within the same session
      // shows the empty state immediately instead of re-running the loop.
      const cached = __getDomainCacheForTests().get('target.com');
      expect(cached?.hasMore).toBe(false);
    });

    it('does not cap once at least one story has been accepted (Regime B)', async () => {
      let call = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        const page = call++;
        if (page === 0) {
          return Promise.resolve(
            new Response(JSON.stringify(body('target.com', [42], 0, 10))),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(noiseBody('target.com', 50, page, 10))),
        );
      });

      const { result } = renderHook(() => useDomainInfiniteStories('target.com'));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.stories.map((s) => s.id)).toEqual([42]);

      // Five consecutive noise pages after the real hit. Cap MUST NOT fire —
      // we're past cold start, so deep pagination stays bounded only by
      // Algolia's `nbPages`. A regression that applied the cap globally
      // would flip `hasMore` to false here.
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await result.current.loadMore();
        });
        expect(result.current.hasMore).toBe(true);
      }
      expect(call).toBe(6);
    });

    it('resets the streak when a fetch yields accepted hits during cold start', async () => {
      // Sequence: noise, noise, real. Without the streak reset on the real
      // page, the counter would persist at 2 and the next noise page would
      // trip the cap — but the real page also enters Regime B, which is the
      // belt-and-suspenders guarantee this test pins.
      let call = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        const page = call++;
        if (page === 2) {
          return Promise.resolve(
            new Response(JSON.stringify(body('target.com', [99], 2, 10))),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(noiseBody('target.com', 50, page, 10))),
        );
      });

      const { result } = renderHook(() => useDomainInfiniteStories('target.com'));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.stories.map((s) => s.id)).toEqual([99]);
      expect(result.current.hasMore).toBe(true);

      // Three more noise pages — would trip the cap if the counter hadn't
      // been reset AND we hadn't entered Regime B.
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await result.current.loadMore();
        });
        expect(result.current.hasMore).toBe(true);
      }
      expect(call).toBe(6);
    });

    it('resets the streak when domain changes mid-flight', async () => {
      let call = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const page = call++;
        const url = fetchInputToUrl(input);
        const targetDomain = url.includes('query=foo') ? 'foo' : 'bar';
        return Promise.resolve(
          new Response(JSON.stringify(noiseBody(targetDomain, 50, page, 10))),
        );
      });

      const { result, rerender } = renderHook(
        ({ domain }: { domain: string }) => useDomainInfiniteStories(domain),
        { initialProps: { domain: 'foo' } },
      );

      // foo: 2 consecutive noise pages → streak=2
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.hasMore).toBe(true);

      // Switch to bar — domain reset block must zero the streak. If it
      // doesn't, the (stale) counter would tip at bar's first noise page
      // and the cap would fire after 1 fetch on the new domain.
      rerender({ domain: 'bar' });
      await waitFor(() => expect(result.current.stories).toEqual([]));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(true);

      // bar: 2 more noise pages — streak should rebuild from 1, not 3
      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.hasMore).toBe(true);

      // bar's 3rd noise page now trips the (freshly-built) cap, proving the
      // counter started over after the domain switch.
      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.hasMore).toBe(false);
    });
  });

  describe('empty domain', () => {
    it('does not fetch and stays in idle state', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify(body('x', []))));

      const { result } = renderHook(() => useDomainInfiniteStories(''));

      expect(result.current.loading).toBe(false);
      expect(result.current.stories).toEqual([]);

      // Drain the auto-load effect so a regression that drops the `!domain`
      // guard would surface as an unexpected fetch.
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { StrictMode } from 'react';
import {
  useUserInfiniteStories,
  formatNoUserSubmissionsTitle,
  __resetUserStoriesCacheForTests,
  __getUserStoriesCacheForTests,
} from './useUserInfiniteStories';

function body(ids: number[], page = 0, nbPages = 1) {
  return {
    hits: ids.map((id) => ({
      objectID: String(id),
      title: `Story ${id}`,
      url: `https://example.com/${id}`,
      author: 'pg',
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

function fetchInputToUrl(input: RequestInfo | URL | undefined): string {
  if (!input) return '';
  if (input instanceof URL) return input.href;
  if (typeof input === 'string') return input;
  return input.url;
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
 * mutations that happen after `await response.json()`. Mirrors the helper in
 * `useDomainInfiniteStories.test.ts`.
 */
function fakeResponse<T>(jsonDeferred: Deferred<T>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => jsonDeferred.promise as unknown as Promise<unknown>,
  } as unknown as Response;
}

/** Extracts the author tag value from a `search_by_date?tags=story,author_X` URL. */
function authorFromUrl(url: string): string {
  const params = new URLSearchParams(url.split('?')[1] ?? '');
  const tags = params.get('tags') ?? '';
  return /author_([^,]+)/.exec(tags)?.[1] ?? '';
}

describe('formatNoUserSubmissionsTitle', () => {
  it('uses "by" instead of "from" for personhood', () => {
    expect(formatNoUserSubmissionsTitle('pg')).toBe('No submissions found by "pg"');
  });

  it('preserves username case verbatim', () => {
    expect(formatNoUserSubmissionsTitle('PaulG')).toBe('No submissions found by "PaulG"');
  });
});

describe('useUserInfiniteStories', () => {
  beforeEach(() => {
    __resetUserStoriesCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads stories for a user on mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body([1, 2, 3]))),
    );

    const { result } = renderHook(() => useUserInfiniteStories('pg'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.stories.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  it('queries Algolia with the AND-tagged author filter and preserves username case', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body([1]))));

    const { result } = renderHook(() => useUserInfiniteStories('PaulG'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const url = fetchInputToUrl(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain('search_by_date');
    expect(url).toMatch(/tags=story%2Cauthor_PaulG|tags=story,author_PaulG/);
  });

  it('returns empty list and hasMore=false on the first round-trip when the user has no stories (no cap loop)', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ hits: [], nbHits: 0, nbPages: 0, page: 0, hitsPerPage: 50 })),
      );
    });

    const { result } = renderHook(() => useUserInfiniteStories('lurker'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stories).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    // Single fetch — no cold-start cap retries (the author tag is exact).
    expect(calls).toBe(1);
  });

  describe('updater purity', () => {
    it('writes the user cache exactly once per successful load under StrictMode', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(body([1, 2, 3]))),
      );

      const cache = __getUserStoriesCacheForTests();
      const originalSet = Map.prototype.set;
      let setCount = 0;
      Map.prototype.set = function (this: Map<unknown, unknown>, key, value) {
        if (this === cache) setCount += 1;
        return originalSet.call(this, key, value);
      };

      try {
        const { result } = renderHook(() => useUserInfiniteStories('pg'), {
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
    it('returns cached stories synchronously on remount and skips the fetch', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify(body([1, 2, 3]))));

      const first = renderHook(() => useUserInfiniteStories('pg'));
      await waitFor(() => expect(first.result.current.loading).toBe(false));
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      first.unmount();
      fetchSpy.mockClear();

      const second = renderHook(() => useUserInfiniteStories('pg'));

      expect(second.result.current.loading).toBe(false);
      expect(second.result.current.stories.map((s) => s.id)).toEqual([1, 2, 3]);

      await Promise.resolve();
      await Promise.resolve();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('sets error on fetch rejection, releases inFlight, and supports manual retry', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(new Response(JSON.stringify(body([1, 2]))));

      const { result } = renderHook(() => useUserInfiniteStories('pg'));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('network down');
      expect(result.current.stories).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

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

      const { result } = renderHook(() => useUserInfiniteStories('pg'));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toMatch(/503/);
      expect(result.current.stories).toEqual([]);
    });
  });

  describe('dedup across pages', () => {
    it('does not include the same story id twice when it appears on consecutive pages', async () => {
      let call = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        const page = call++;
        return Promise.resolve(
          new Response(
            JSON.stringify(page === 0 ? body([1, 2], 0, 2) : body([2, 3], 1, 2)),
          ),
        );
      });

      const { result } = renderHook(() => useUserInfiniteStories('pg'));

      await waitFor(() => expect(result.current.stories.map((s) => s.id)).toEqual([1, 2]));
      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.stories.map((s) => s.id)).toEqual([1, 2, 3]);
      expect(result.current.hasMore).toBe(false);
    });
  });

  describe('username change', () => {
    it('discards stale state and re-fetches when username changes', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = fetchInputToUrl(input);
        const isPg = url.includes('author_pg');
        return Promise.resolve(
          new Response(JSON.stringify(body(isPg ? [1, 2] : [10, 11]))),
        );
      });

      const { result, rerender } = renderHook(
        ({ username }: { username: string }) => useUserInfiniteStories(username),
        { initialProps: { username: 'pg' } },
      );

      await waitFor(() => expect(result.current.stories.map((s) => s.id)).toEqual([1, 2]));

      rerender({ username: 'dang' });
      await waitFor(() => expect(result.current.stories.map((s) => s.id)).toEqual([10, 11]));
    });
  });

  describe('username-change staleness', () => {
    it('discards stale response that resolves AFTER a rerender to a new username', async () => {
      // Scenario: user navigates to dang BEFORE pg's fetch() resolves. The
      // first version check (after `await fetch()`) must catch it.
      const deferredByUser = new Map<string, Deferred<Response>>();

      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = fetchInputToUrl(input);
        const author = authorFromUrl(url);
        const d = defer<Response>();
        deferredByUser.set(author, d);
        return d.promise;
      });

      const { result, rerender } = renderHook(
        ({ username }: { username: string }) => useUserInfiniteStories(username),
        { initialProps: { username: 'pg' } },
      );

      await waitFor(() => expect(deferredByUser.has('pg')).toBe(true));

      rerender({ username: 'dang' });
      await waitFor(() => expect(deferredByUser.has('dang')).toBe(true));

      await act(async () => {
        deferredByUser.get('pg')!.resolve(
          new Response(JSON.stringify(body([1, 2, 3]))),
        );
        deferredByUser.get('dang')!.resolve(
          new Response(JSON.stringify(body([100, 101]))),
        );
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.stories.map((s) => s.id)).toEqual([100, 101]);
    });

    it('discards stale response whose json() resolves AFTER a rerender to a new username', async () => {
      // Scenario: pg's fetch() has resolved and passed the first version
      // check; we're inside `await response.json()` when the rerender happens.
      // This is the case the single pre-json check would miss; the second
      // check after json() (line 122 of useUserInfiniteStories.ts) catches it.
      // Without the second guard, pg's stale response would clobber dang's
      // committed stories AND poison `userStoriesCache.set(pg, ...)`.
      const fetchDeferred = new Map<string, Deferred<Response>>();
      const jsonDeferred = new Map<string, Deferred<unknown>>();

      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = fetchInputToUrl(input);
        const author = authorFromUrl(url);
        const fd = defer<Response>();
        const jd = defer<unknown>();
        fetchDeferred.set(author, fd);
        jsonDeferred.set(author, jd);
        return fd.promise;
      });

      const { result, rerender } = renderHook(
        ({ username }: { username: string }) => useUserInfiniteStories(username),
        { initialProps: { username: 'pg' } },
      );

      await waitFor(() => expect(fetchDeferred.has('pg')).toBe(true));

      // pg's fetch resolves but json() is still pending.
      await act(async () => {
        fetchDeferred.get('pg')!.resolve(fakeResponse(jsonDeferred.get('pg')!));
        await Promise.resolve();
        await Promise.resolve();
      });

      // Rerender to dang while pg's json() is pending.
      rerender({ username: 'dang' });
      await waitFor(() => expect(fetchDeferred.has('dang')).toBe(true));

      // dang's fetch resolves cleanly (real Response, .json() resolves
      // synchronously after the fetch).
      await act(async () => {
        fetchDeferred.get('dang')!.resolve(
          new Response(JSON.stringify(body([100, 101]))),
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // pg's stale json() finally resolves — the second version check must
      // discard it. Without it, pg's [1, 2, 3] would overwrite dang's
      // [100, 101] AND `userStoriesCache.set('pg', ...)` would poison the
      // cache with whatever pg's response was.
      await act(async () => {
        jsonDeferred.get('pg')!.resolve(body([1, 2, 3]));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.stories.map((s) => s.id)).toEqual([100, 101]);
      // Cache for pg was never written; dang's entry is the only one present.
      expect(__getUserStoriesCacheForTests().has('pg')).toBe(false);
      expect(
        __getUserStoriesCacheForTests().get('dang')?.stories.map((s) => s.id),
      ).toEqual([100, 101]);
    });
  });

  describe('reset', () => {
    it('clears state, removes the cache entry, and triggers a fresh fetch', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify(body([1, 2, 3]))))
        .mockResolvedValueOnce(new Response(JSON.stringify(body([10, 11]))));

      const { result } = renderHook(() => useUserInfiniteStories('pg'));

      await waitFor(() => expect(result.current.stories.length).toBe(3));
      expect(__getUserStoriesCacheForTests().has('pg')).toBe(true);

      act(() => {
        result.current.reset();
      });

      expect(__getUserStoriesCacheForTests().has('pg')).toBe(false);

      await waitFor(() =>
        expect(result.current.stories.map((s) => s.id)).toEqual([10, 11]),
      );
      expect(__getUserStoriesCacheForTests().has('pg')).toBe(true);
    });
  });

  describe('empty username', () => {
    it('does not fetch and stays in idle state', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify(body([]))));

      const { result } = renderHook(() => useUserInfiniteStories(''));

      expect(result.current.loading).toBe(false);
      expect(result.current.stories).toEqual([]);

      await Promise.resolve();
      await Promise.resolve();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

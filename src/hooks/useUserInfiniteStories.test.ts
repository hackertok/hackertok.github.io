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

  it('queries Algolia for the stories and polls by the author, preserving username case', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body([1]))));

    const { result } = renderHook(() => useUserInfiniteStories('PaulG'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const url = new URL(fetchInputToUrl(fetchSpy.mock.calls[0]?.[0]));
    expect(url.pathname).toContain('search_by_date');
    expect(url.searchParams.get('tags')).toBe('(story,poll),author_PaulG');
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

  describe('more submissions than search returns', () => {
    it('loads past the last page from the oldest story so far', async () => {
      const hit = (id: number, createdAt: number) => ({ ...body([id]).hits[0], created_at_i: createdAt });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const filter = new URL(fetchInputToUrl(input)).searchParams.get('numericFilters');
        // Search stops at 1,000 hits and caps nbPages to match, so its last
        // page doesn't reach nbHits.
        return Promise.resolve(Response.json(filter === null
          ? { hits: [hit(1, 300), hit(2, 200)], nbHits: 1500, nbPages: 1, page: 0, hitsPerPage: 50 }
          : { hits: [hit(2, 200), hit(3, 100)], nbHits: 2, nbPages: 1, page: 0, hitsPerPage: 50 }));
      });

      const { result } = renderHook(() => useUserInfiniteStories('pg'));
      await waitFor(() => expect(result.current.stories.map((s) => s.id)).toEqual([1, 2]));
      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });

      const nextUrl = new URL(fetchInputToUrl(fetchSpy.mock.calls[1]?.[0]));
      expect(nextUrl.searchParams.get('numericFilters')).toBe('created_at_i<=200');
      expect(nextUrl.searchParams.get('page')).toBe('0');
      expect(result.current.stories.map((s) => s.id)).toEqual([1, 2, 3]);
      expect(result.current.hasMore).toBe(false);
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

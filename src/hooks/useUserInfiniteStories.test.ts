import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useUserInfiniteStories,
  __resetUserStoriesCacheForTests,
} from './useUserInfiniteStories';

function body(ids: number[]) {
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
    nbPages: 1,
    page: 0,
    hitsPerPage: 50,
  };
}

function fetchInputToUrl(input: RequestInfo | URL | undefined): string {
  if (!input) return '';
  if (input instanceof URL) return input.href;
  if (typeof input === 'string') return input;
  return input.url;
}

describe('useUserInfiniteStories', () => {
  beforeEach(() => {
    __resetUserStoriesCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

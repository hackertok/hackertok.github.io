import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInfiniteStories } from './useInfiniteStories';
import { setCachedFeed, clearFeedCache } from '../utils/feedCache';
import { clearListSessionState } from '../utils/itemCache';
import { createStoryItem } from '../test/factories';
import { server } from '../mocks/server';
import { hnSdk } from '../api/hnSdk';
import { __resetFetchCachesForTests } from '../api/hn';
import type { FeedType, FirebaseItem } from '../types';

function makeFirebaseItem(id: number): FirebaseItem {
  return {
    id,
    title: `Story ${id}`,
    url: `https://example.com/${id}`,
    by: 'testuser',
    score: 50 + id,
    time: Math.floor(Date.now() / 1000) - 3600,
    descendants: 5,
    type: 'story',
  };
}

// Generate 50 item IDs for ranked lists
const rankedIds = Array.from({ length: 50 }, (_, i) => i + 1);

describe('useInfiniteStories', () => {
  beforeEach(() => {
    clearFeedCache();
    clearListSessionState('top');
    clearListSessionState('best');
    clearListSessionState('show');
    clearListSessionState('ask');
    clearListSessionState('newest');
    __resetFetchCachesForTests();
    vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(rankedIds);
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => makeFirebaseItem(Number(id)));
  });

  afterEach(() => {
    server.resetHandlers();
    clearFeedCache();
    vi.restoreAllMocks();
  });

  it('loads stories on first loadMore when no cache', async () => {
    const { result } = renderHook(() => useInfiniteStories('top'));

    expect(result.current.stories).toHaveLength(0);
    expect(result.current.hasMore).toBe(true);

    await act(() => result.current.loadMore());

    expect(result.current.stories.length).toBeGreaterThan(0);
    expect(result.current.loading).toBe(false);
  });

  it('initializes from cache and marks isFromCache', () => {
    const cached = Array.from({ length: 20 }, (_, i) =>
      createStoryItem({ id: i + 1, title: `Cached Story ${i + 1}` }),
    );
    setCachedFeed('top', cached);

    const { result } = renderHook(() => useInfiniteStories('top'));

    expect(result.current.stories).toHaveLength(20);
    expect(result.current.isFromCache).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('replaces stories on revalidation when loadMore is called early (position 0)', async () => {
    const cached = Array.from({ length: 20 }, (_, i) =>
      createStoryItem({ id: i + 1, title: `Cached Story ${i + 1}` }),
    );
    setCachedFeed('top', cached);

    const { result } = renderHook(() => useInfiniteStories('top'));

    // Starts from cache
    expect(result.current.stories).toHaveLength(20);
    expect(result.current.isFromCache).toBe(true);

    // First loadMore triggers revalidation (replaces stories)
    await act(() => result.current.loadMore());

    expect(result.current.isFromCache).toBe(false);
    // Stories are replaced with fresh data from MSW (default handler returns 20 stories)
    expect(result.current.stories.length).toBeGreaterThan(0);
  });

  it('appends stories on second loadMore after revalidation', async () => {
    const cached = Array.from({ length: 20 }, (_, i) =>
      createStoryItem({ id: i + 1, title: `Cached Story ${i + 1}` }),
    );
    setCachedFeed('top', cached);

    const { result } = renderHook(() => useInfiniteStories('top'));

    // First loadMore: revalidation (replace)
    await act(() => result.current.loadMore());
    const afterRevalidation = result.current.stories.length;

    // Second loadMore: should APPEND, not replace
    await act(() => result.current.loadMore());

    expect(result.current.stories.length).toBeGreaterThanOrEqual(afterRevalidation);
  });

  it('starts one request when loadMore is called twice before re-rendering', async () => {
    const { result } = renderHook(() => useInfiniteStories('top'));

    // Same closure twice — what two effects in one commit both see.
    const { loadMore } = result.current;
    await act(() => Promise.all([loadMore(), loadMore()]));

    expect(hnSdk.readRankedIds).toHaveBeenCalledTimes(1);
    expect(result.current.stories).toHaveLength(20);
    expect(result.current.loading).toBe(false);
  });

  it('accepts a new loadMore once the previous one settles', async () => {
    const { result } = renderHook(() => useInfiniteStories('best'));

    await act(() => result.current.loadMore());
    await act(() => result.current.loadMore());

    expect(result.current.stories).toHaveLength(50);
  });

  it('does not repeat stories after going Back to a feed whose session was saved', async () => {
    // StoryList stays mounted across feed routes and calls reset() when `type` changes.
    const { result, rerender } = renderHook(
      ({ type }: { type: FeedType }) => useInfiniteStories(type),
      { initialProps: { type: 'best' } },
    );
    await act(() => result.current.loadMore());
    // Opening a story saves the session.
    act(() => result.current.saveSessionState(0));

    rerender({ type: 'newest' });
    act(() => result.current.reset());
    rerender({ type: 'best' });
    act(() => result.current.reset());

    await act(() => result.current.loadMore());
    await act(() => result.current.loadMore());

    const ids = result.current.stories.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(50);
  });
});

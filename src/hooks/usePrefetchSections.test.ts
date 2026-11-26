import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePrefetchSections } from './usePrefetchSections';
import { fetchBestStories, fetchShowStories, fetchAskStories, fetchNewStories, prefetchItemComments } from '../api/hn';
import { getCachedFeed, setCachedFeed } from '../utils/feedCache';
import { getCachedItem, setCachedItem } from '../utils/itemCache';
import { markViewedWithTime, clearViewedTimes, clearSessionViewed } from '../utils/viewedItems';
import { createStoryItem } from '../test/factories';
import type { FeedType, PrefetchResult, StoryItem } from '../types';

vi.mock('../api/hn', () => ({
  fetchTopStories: vi.fn(),
  fetchBestStories: vi.fn(),
  fetchShowStories: vi.fn(),
  fetchAskStories: vi.fn(),
  fetchNewStories: vi.fn(),
  prefetchItemComments: vi.fn(),
}));

const lists = {
  best: [createStoryItem({ id: 11 }), createStoryItem({ id: 12 })],
  show: [createStoryItem({ id: 21 })],
  ask: [createStoryItem({ id: 31 })],
  newest: [createStoryItem({ id: 41 })],
};

const page = (stories: StoryItem[]) => ({ stories, hasMore: true, nextOffset: stories.length });
const thread = (id: number): PrefetchResult => ({ item: createStoryItem({ id }), comments: [] });
const prefetchedIds = () => vi.mocked(prefetchItemComments).mock.calls.map(([id]) => id);

describe('usePrefetchSections', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchBestStories).mockResolvedValue(page(lists.best));
    vi.mocked(fetchShowStories).mockResolvedValue(page(lists.show));
    vi.mocked(fetchAskStories).mockResolvedValue(page(lists.ask));
    vi.mocked(fetchNewStories).mockResolvedValue(page(lists.newest));
    vi.mocked(prefetchItemComments).mockImplementation(async id => thread(Number(id)));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    clearViewedTimes();
    clearSessionViewed();
  });

  it('caches every other feed and the thread of the story each opens on', async () => {
    // Read in an earlier session, so Best opens on its second story.
    markViewedWithTime(11);
    clearSessionViewed();

    renderHook(() => usePrefetchSections('top'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(getCachedFeed('show')?.stories).toEqual(lists.show);
    expect(prefetchedIds()).toEqual([12, 21, 31, 41]);
    expect(getCachedItem(12)).not.toBeNull();
  });

  it('leaves a cached thread to refresh when opened, however old', async () => {
    setCachedItem(11, createStoryItem({ id: 11 }), []);
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    for (const [type, stories] of Object.entries(lists)) setCachedFeed(type as FeedType, stories);

    renderHook(() => usePrefetchSections('top'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchBestStories).not.toHaveBeenCalled();
    expect(prefetchedIds()).toEqual([21, 31, 41]);
  });

  it('does not let a stalled list hold up the other feeds', async () => {
    vi.mocked(fetchShowStories).mockReturnValue(new Promise(() => { /* never resolves */ }));

    renderHook(() => usePrefetchSections('top'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(prefetchedIds()).toEqual([11, 31, 41]);
  });

  it('waits until the current feed is ready', async () => {
    const { rerender } = renderHook(({ ready }) => usePrefetchSections('top', ready), { initialProps: { ready: false } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchBestStories).not.toHaveBeenCalled();

    rerender({ ready: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchBestStories).toHaveBeenCalled();
  });

  it('does not replace a copy the story cached while its thread downloaded', async () => {
    let finish!: () => void;
    vi.mocked(prefetchItemComments).mockImplementationOnce(id => new Promise(resolve => {
      finish = () => resolve(thread(Number(id)));
    }));

    const { unmount } = renderHook(() => usePrefetchSections('top'));
    await vi.advanceTimersByTimeAsync(1000);
    unmount();
    const newer = createStoryItem({ id: 11, title: 'Opened meanwhile' });
    setCachedItem(11, newer, []);
    finish();
    await vi.advanceTimersByTimeAsync(0);

    expect(getCachedItem(11)?.item).toEqual(newer);
    expect(prefetchedIds()).toEqual([11]);
  });
});

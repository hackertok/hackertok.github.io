import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useItemWithComments } from './useItemWithComments';
import { setCachedItem, getCachedItem, ITEM_CACHE_KEY_PREFIX } from '../utils/itemCache';
import { _resetForTesting, isPriorityFetchActive } from '../utils/fetchPriority';
import { server } from '../mocks/server';
import { hnSdk } from '../api/hnSdk';
import { ALGOLIA_API } from '../config/api';
import type { FirebaseItem } from '../types';
import { createStoryItem, createComment } from '../test/factories';
import { NetworkStatusProvider } from '../context/NetworkStatusContext';
import type { ReactNode } from 'react';

const mockFirebaseStory: FirebaseItem = {
  id: 12345,
  title: 'Sample HN Post',
  url: 'https://example.com',
  by: 'testuser',
  score: 100,
  time: Math.floor(Date.now() / 1000) - 3600,
  descendants: 3,
  kids: [1001, 1002],
  type: 'story',
};

const testItem = createStoryItem({
  id: 12345,
  title: 'Sample HN Post',
  url: 'https://example.com',
  author: 'testuser',
  points: 100,
  createdAt: Math.floor(Date.now() / 1000) - 3600,
  commentCount: 3,
  type: 'story',
});

const testComments = [
  createComment({ id: 1001, text: 'Comment 1', author: 'user1' }),
  createComment({ id: 1002, text: 'Comment 2', author: 'user2' }),
];

describe('useItemWithComments', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 12345) return mockFirebaseStory;
      return null;
    });
  });

  afterEach(() => {
    _resetForTesting();
    vi.restoreAllMocks();
  });

  describe('basic fetching', () => {
    it('fetches item and comments when cache is empty', async () => {
      const { result } = renderHook(() => useItemWithComments(12345));

      expect(result.current.itemLoading).toBe(true);
      expect(result.current.commentsLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.itemLoading).toBe(false);
      });

      expect(result.current.item).toBeTruthy();
      expect(result.current.item!.id).toBe(12345);
    });

    it('reads the cache when it mounts, not on every render', () => {
      setCachedItem(12345, testItem, testComments);
      const cached = localStorage.getItem(`${ITEM_CACHE_KEY_PREFIX}12345`);
      const parse = vi.spyOn(JSON, 'parse');
      const cacheReads = () => parse.mock.calls.filter(([text]) => text === cached).length;

      const { rerender } = renderHook(() => useItemWithComments(12345));
      const readsOnMount = cacheReads();
      rerender();
      rerender();
      rerender();

      expect(readsOnMount).toBeGreaterThan(0);
      expect(cacheReads()).toBe(readsOnMount);
    });

    it('accepts initialItem prop to skip item fetch', async () => {
      const { result } = renderHook(() =>
        useItemWithComments(12345, { initialItem: testItem })
      );

      expect(result.current.itemLoading).toBe(false);
      expect(result.current.item).toEqual(testItem);

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });
    });
  });

  describe('initialItem without text (restored swipe position)', () => {
    const body = '<p>Ask HN body</p>';

    it('takes the body from the cached copy without fetching', () => {
      setCachedItem(12345, { ...testItem, text: body }, testComments);

      const { result } = renderHook(() =>
        useItemWithComments(12345, { initialItem: testItem })
      );

      expect(result.current.item).toEqual({ ...testItem, text: body });
      expect(hnSdk.readItem).not.toHaveBeenCalled();
    });

    it('takes the body from the item fetched with the comments, and caches it', async () => {
      vi.spyOn(hnSdk, 'readItem').mockResolvedValue({ ...mockFirebaseStory, text: body, score: 999 });
      const askItem = { ...testItem, type: 'ask' as const };

      const { result } = renderHook(() =>
        useItemWithComments(12345, { initialItem: askItem })
      );

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });
      // Firebase calls Ask HN posts `story`, so the type stays the feed's.
      expect(result.current.item).toEqual({ ...askItem, text: body, points: 999 });
      expect(getCachedItem(12345)?.item).toEqual({ ...askItem, text: body, points: 999 });
    });
  });

  describe('deferComments option', () => {
    it('skips comment fetch when deferComments is true', async () => {
      const { result } = renderHook(() =>
        useItemWithComments(12345, {
          initialItem: testItem,
          deferComments: true
        })
      );

      expect(result.current.item).toEqual(testItem);

      // null (not the loading sentinel) signals "deferred, not in flight".
      expect(result.current.comments).toBeNull();

      // Drain microtasks so a regression that kicks off an async fetch surfaces.
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      expect(result.current.comments).toBeNull();
    });

    it('loads comments when deferComments changes to false', async () => {
      const { result, rerender } = renderHook(
        ({ deferComments }) => useItemWithComments(12345, {
          initialItem: testItem,
          deferComments
        }),
        { initialProps: { deferComments: true } }
      );

      expect(result.current.comments).toBeNull();

      rerender({ deferComments: false });

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      expect(result.current.comments).toBeTruthy();
    });
  });

  describe('priority fetch lifecycle', () => {
    it('registers priority on fetch start and unregisters on success', async () => {
      expect(isPriorityFetchActive()).toBe(false);

      const { result } = renderHook(() =>
        useItemWithComments(12345, { isPriority: true })
      );

      // Registration happens synchronously before the first await.
      expect(isPriorityFetchActive()).toBe(true);

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      expect(isPriorityFetchActive()).toBe(false);
    });

    it('unregisters priority on item fetch failure', async () => {
      vi.spyOn(hnSdk, 'readItem').mockResolvedValue(null);

      expect(isPriorityFetchActive()).toBe(false);

      const { result } = renderHook(() =>
        useItemWithComments(99999, { isPriority: true })
      );

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });

      expect(isPriorityFetchActive()).toBe(false);
    });

    it('unregisters priority on comments fetch failure', async () => {
      server.use(
        http.get(`${ALGOLIA_API}/items/:id`, () => {
          return HttpResponse.json({ error: 'Server error' }, { status: 500 });
        })
      );

      expect(isPriorityFetchActive()).toBe(false);

      const { result } = renderHook(() =>
        useItemWithComments(12345, {
          initialItem: testItem,
          isPriority: true
        })
      );

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      }, { timeout: 3000 });

      expect(isPriorityFetchActive()).toBe(false);
    });

    it('unregisters priority on unmount', async () => {
      expect(isPriorityFetchActive()).toBe(false);

      const { unmount } = renderHook(() =>
        useItemWithComments(12345, { isPriority: true })
      );

      expect(isPriorityFetchActive()).toBe(true);

      unmount();

      expect(isPriorityFetchActive()).toBe(false);
    });

    it('does not register priority when cache has comments', async () => {
      setCachedItem(12345, testItem, testComments);

      expect(isPriorityFetchActive()).toBe(false);

      renderHook(() =>
        useItemWithComments(12345, { isPriority: true })
      );

      // Cache hit must short-circuit before the priority registration runs.
      expect(isPriorityFetchActive()).toBe(false);
    });
  });

  describe('abort handling', () => {
    it('aborts fetch on unmount', async () => {
      const abortSpy = vi.fn();
      const originalAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function() {
        abortSpy();
        return originalAbort.call(this);
      };

      const { unmount } = renderHook(() => useItemWithComments(12345));

      unmount();

      expect(abortSpy).toHaveBeenCalled();

      AbortController.prototype.abort = originalAbort;
    });

    it('does NOT abort when deferComments changes to true (same itemId)', async () => {
      // Mobile swipe scenario: item at index 0 starts fetching, then the user
      // swipes away so it becomes deferred. The in-flight fetch must complete
      // in the background so a swipe back gets an instant cache hit.
      const abortSpy = vi.fn();
      const originalAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function() {
        abortSpy();
        return originalAbort.call(this);
      };

      const { result, rerender } = renderHook(
        ({ deferComments }) => useItemWithComments(12345, {
          initialItem: testItem,
          deferComments
        }),
        { initialProps: { deferComments: false } }
      );

      expect(result.current.commentsLoading).toBe(true);

      rerender({ deferComments: true });

      expect(abortSpy).not.toHaveBeenCalled();

      AbortController.prototype.abort = originalAbort;

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      expect(result.current.comments).toBeTruthy();
    });

    it('DOES abort when itemId changes even if new item has deferComments=true', async () => {
      // Guards against a check that only inspects `deferComments.current` —
      // that would incorrectly suppress abort on a real itemId change too.
      const abortSpy = vi.fn();
      const originalAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function() {
        abortSpy();
        return originalAbort.call(this);
      };

      const { rerender } = renderHook(
        ({ itemId, deferComments }) => useItemWithComments(itemId, {
          initialItem: testItem,
          deferComments
        }),
        { initialProps: { itemId: 12345, deferComments: false } }
      );

      rerender({ itemId: 99999, deferComments: true });

      expect(abortSpy).toHaveBeenCalled();

      AbortController.prototype.abort = originalAbort;
    });
  });

  describe('error handling', () => {
    it('sets error state on item fetch failure', async () => {
      vi.spyOn(hnSdk, 'readItem').mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useItemWithComments(12345));

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });

      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
    });

    it('handles comment fetch failure gracefully (item still shows)', async () => {
      // Item succeeds but comments fail — non-fatal, item stays visible.
      server.use(
        http.get(`${ALGOLIA_API}/items/:id`, () => {
          return HttpResponse.error();
        })
      );

      const { result } = renderHook(() =>
        useItemWithComments(12345, { initialItem: testItem })
      );

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      expect(result.current.item).toEqual(testItem);
      expect(result.current.error).toBeNull();
    });
  });

  describe('stale cache revalidation', () => {
    function seedStaleCache() {
      localStorage.setItem(`${ITEM_CACHE_KEY_PREFIX}12345`, JSON.stringify({
        item: testItem,
        comments: testComments,
        timestamp: Date.now() - 60 * 60 * 1000,
      }));
    }

    it('updates the title, points and comment count from the revalidation', async () => {
      vi.spyOn(hnSdk, 'readItem').mockResolvedValue({
        ...mockFirebaseStory, title: 'Renamed by a moderator', score: 450, descendants: 120,
      });
      seedStaleCache();

      const { result } = renderHook(() => useItemWithComments(12345));
      expect(result.current.item).toEqual(testItem);

      const fresh = { ...testItem, title: 'Renamed by a moderator', points: 450, commentCount: 120 };
      await waitFor(() => {
        expect(result.current.item).toEqual(fresh);
      });
      expect(getCachedItem(12345)?.item).toEqual(fresh);
    });

    it('keeps the cached title when the story has since been deleted', async () => {
      vi.spyOn(hnSdk, 'readItem').mockResolvedValue({
        id: 12345, deleted: true, time: mockFirebaseStory.time, type: 'story',
      });
      seedStaleCache();

      const { result } = renderHook(() => useItemWithComments(12345));

      await waitFor(() => {
        expect(getCachedItem(12345)?.isFresh).toBe(true);
      });
      expect(result.current.item).toEqual(testItem);
      expect(getCachedItem(12345)?.item).toEqual(testItem);
    });

    it('takes the poll option type from the revalidation over a copy cached as a story', async () => {
      vi.spyOn(hnSdk, 'readItem').mockResolvedValue({ id: 12345, text: 'Yes', by: 'pg', score: 30, time: mockFirebaseStory.time, type: 'pollopt' });
      seedStaleCache();

      const { result } = renderHook(() => useItemWithComments(12345));

      await waitFor(() => {
        expect(result.current.item?.type).toBe('pollopt');
      });
      expect(getCachedItem(12345)?.item.type).toBe('pollopt');
    });

    it('fetches when cache has no comments', async () => {
      const CACHE_KEY = `${ITEM_CACHE_KEY_PREFIX}12345`;
      const partialData = {
        item: testItem,
        comments: null,
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(partialData));

      const { result } = renderHook(() => useItemWithComments(12345));

      expect(result.current.item).toEqual(testItem);
      expect(result.current.itemLoading).toBe(false);

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      expect(result.current.comments).toBeTruthy();
    });
  });

  describe('with no copy of the item', () => {
    it('reads the item once, and its comments without waiting for it', async () => {
      let releaseItem!: () => void;
      const itemRead = new Promise<FirebaseItem>(resolve => { releaseItem = () => resolve(mockFirebaseStory); });
      let readsOfItem = 0;
      vi.spyOn(hnSdk, 'readItem').mockImplementation(id => {
        if (Number(id) !== 12345) return Promise.resolve(null);
        readsOfItem++;
        return itemRead;
      });
      let commentSearches = 0;
      server.use(
        http.get(`${ALGOLIA_API}/search`, () => {
          commentSearches++;
          return HttpResponse.json({
            hits: [{ objectID: '1001', author: 'user1', comment_text: 'Test', created_at_i: 1000, parent_id: 12345, story_id: 12345 }],
            nbHits: 1,
          });
        }),
      );

      const { result } = renderHook(() => useItemWithComments(12345));

      // The search is out before the item arrives, and the item is read once.
      await waitFor(() => expect(commentSearches).toBe(1));
      expect(readsOfItem).toBe(1);
      expect(result.current.itemLoading).toBe(true);

      releaseItem();

      await waitFor(() => expect(result.current.comments).toHaveLength(1));
      expect(result.current.item?.id).toBe(12345);
      expect(commentSearches).toBe(1);
      expect(readsOfItem).toBe(1);
    });
  });

  describe('itemId type handling', () => {
    it('handles string itemId', async () => {
      const { result } = renderHook(() => useItemWithComments('12345'));

      await waitFor(() => {
        expect(result.current.itemLoading).toBe(false);
      });

      expect(result.current.item).toBeTruthy();
      expect(result.current.item!.id).toBe(12345);
    });

    it('shares cache between string and number itemId', async () => {
      setCachedItem(12345, testItem, testComments);

      const { result } = renderHook(() => useItemWithComments('12345'));

      // Cache key uses String(id), so number-set / string-get must collide.
      expect(result.current.item).toEqual(testItem);
      expect(result.current.comments).toEqual(testComments);
    });
  });

  describe('itemId change to cached item', () => {
    it('syncs state when itemId changes to a different fully-cached item', async () => {
      // Cached → cached navigation must hop straight to B's data without
      // briefly flashing A's; otherwise back/forward feels stale.
      const itemA = createStoryItem({ id: 11111, title: 'Item A', url: 'https://a.com', points: 10, author: 'userA', createdAt: Date.now(), commentCount: 1 });
      const itemB = createStoryItem({ id: 22222, title: 'Item B', url: 'https://b.com', points: 20, author: 'userB', createdAt: Date.now(), commentCount: 2 });
      const commentsA = [createComment({ id: 1001, text: 'Comment for item A', author: 'commenterA' })];
      const commentsB = [createComment({ id: 2001, text: 'Comment for item B', author: 'commenterB' })];

      setCachedItem(11111, itemA, commentsA);
      setCachedItem(22222, itemB, commentsB);

      const { result, rerender } = renderHook(
        ({ itemId }) => useItemWithComments(itemId),
        { initialProps: { itemId: 11111 } }
      );

      expect(result.current.item).toEqual(itemA);
      expect(result.current.comments).toEqual(commentsA);
      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);

      rerender({ itemId: 22222 });

      expect(result.current.item).toEqual(itemB);
      expect(result.current.comments).toEqual(commentsB);
      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
    });
  });

  describe('itemId change to UNCACHED item', () => {
    it('resets state when itemId changes to an uncached item', async () => {
      // ItemDetail navigating cached-A → uncached-B must not show A's data
      // for any frame after the prop change (would otherwise look like a no-op nav).
      const itemA = createStoryItem({ id: 33333, title: 'Cached Item A', url: 'https://example1.com', points: 100, author: 'user1', createdAt: Date.now(), commentCount: 5 });
      const commentsA = [createComment({ id: 3001, text: 'Comment for cached A', author: 'commenter1' })];

      setCachedItem(33333, itemA, commentsA);

      // 50ms delay simulates a real network round trip so the test can
      // observe the "loading null" intermediate state.
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === 44444) {
          await new Promise(resolve => setTimeout(resolve, 50));
          return {
            id: 44444,
            type: 'story',
            title: 'Fresh Item B',
            url: 'https://example2.com',
            score: 200,
            by: 'user2',
            time: Math.floor(Date.now() / 1000),
            descendants: 10,
          };
        }
        return mockFirebaseStory;
      });

      const { result, rerender } = renderHook(
        ({ itemId }) => useItemWithComments(itemId),
        { initialProps: { itemId: 33333 } }
      );

      expect(result.current.item).toEqual(itemA);
      expect(result.current.comments).toEqual(commentsA);

      rerender({ itemId: 44444 });

      // Either null (loading) or the new B is acceptable; the old A is not.
      expect(result.current.item?.id).not.toBe(33333);

      // Let async updates settle to avoid act() warnings
      await waitFor(() => {
        expect(result.current.itemLoading).toBe(false);
      });
    });
  });

  describe('reconnect handler', () => {
    const networkWrapper = ({ children }: { children: ReactNode }) => (
      <NetworkStatusProvider>{children}</NetworkStatusProvider>
    );

    afterEach(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
    });

    it('retries comments when going online with a stuck comment fetch', async () => {
      // Item rendered via initialItem; comment fetch hangs to mimic an offline TCP stall.
      let resolveComments: (() => void) | undefined;
      server.use(
        http.get(`${ALGOLIA_API}/search`, async () => {
          await new Promise<void>(resolve => { resolveComments = resolve; });
          return HttpResponse.json({ hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 200 });
        })
      );

      const { result } = renderHook(
        () => useItemWithComments(12345, { initialItem: testItem }),
        { wrapper: networkWrapper }
      );

      expect(result.current.item).toEqual(testItem);
      expect(result.current.commentsLoading).toBe(true);
      expect(result.current.comments).toBeNull();

      // Swap in a succeeding handler before triggering reconnect.
      server.use(
        http.get(`${ALGOLIA_API}/search`, () => {
          return HttpResponse.json({
            hits: [{ objectID: '1001', author: 'user1', comment_text: 'Test', created_at_i: 1000, parent_id: 12345, story_id: 12345 }],
            nbHits: 1, page: 0, nbPages: 1, hitsPerPage: 200,
          });
        })
      );

      act(() => { window.dispatchEvent(new Event('offline')); });
      act(() => { window.dispatchEvent(new Event('online')); });

      // Free the hanging promise so the test runner doesn't leak it.
      resolveComments?.();

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });
      expect(result.current.comments).toBeTruthy();
      expect(result.current.comments!.length).toBeGreaterThan(0);
    });

    it('keeps the body of a restored story whose comments arrive through the retry', async () => {
      const body = '<p>Ask HN body</p>';
      vi.spyOn(hnSdk, 'readItem').mockResolvedValue({ ...mockFirebaseStory, text: body });
      let resolveComments: (() => void) | undefined;
      server.use(
        http.get(`${ALGOLIA_API}/search`, async () => {
          await new Promise<void>(resolve => { resolveComments = resolve; });
          return HttpResponse.json({ hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 200 });
        })
      );

      // testItem has no `text`, like a story restored from a swipe position.
      const { result } = renderHook(
        () => useItemWithComments(12345, { initialItem: testItem }),
        { wrapper: networkWrapper }
      );

      server.use(
        http.get(`${ALGOLIA_API}/search`, () => HttpResponse.json({
          hits: [{ objectID: '1001', author: 'user1', comment_text: 'Test', created_at_i: 1000, parent_id: 12345, story_id: 12345 }],
          nbHits: 1, page: 0, nbPages: 1, hitsPerPage: 200,
        }))
      );
      act(() => { window.dispatchEvent(new Event('offline')); });
      act(() => { window.dispatchEvent(new Event('online')); });
      resolveComments?.();

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });
      expect(result.current.item).toEqual({ ...testItem, text: body });
      expect(getCachedItem(12345)?.item).toEqual({ ...testItem, text: body });
    });

    it('does not retry when comments already loaded', async () => {
      // Pre-cache so nothing should fetch on reconnect.
      setCachedItem(12345, testItem, testComments);

      const fetchSpy = vi.fn();
      const origFetch = globalThis.fetch;
      globalThis.fetch = (...args) => {
        fetchSpy();
        return origFetch(...args);
      };

      const { result } = renderHook(
        () => useItemWithComments(12345),
        { wrapper: networkWrapper }
      );

      expect(result.current.comments).toEqual(testComments);
      fetchSpy.mockClear();

      act(() => { window.dispatchEvent(new Event('offline')); });
      act(() => { window.dispatchEvent(new Event('online')); });

      // Drain microtasks; reconnect must NOT trigger a fetch when comments are loaded.
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      expect(fetchSpy).not.toHaveBeenCalled();

      globalThis.fetch = origFetch;
    });

    it('sets commentsError when reconnect fetch fails', async () => {
      // First fetch hangs forever — simulates offline.
      server.use(
        http.get(`${ALGOLIA_API}/search`, async () => {
          await new Promise(resolve => { void resolve; });
          return HttpResponse.json({ hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 200 });
        })
      );

      const { result } = renderHook(
        () => useItemWithComments(12345, { initialItem: testItem }),
        { wrapper: networkWrapper }
      );

      expect(result.current.commentsLoading).toBe(true);

      // Both endpoints must fail since fetchItemWithComments touches Firebase too.
      vi.spyOn(hnSdk, 'readItem').mockRejectedValue(new Error('Offline'));
      server.use(
        http.get(`${ALGOLIA_API}/search`, () => {
          return new HttpResponse(null, { status: 500 });
        })
      );

      act(() => { window.dispatchEvent(new Event('offline')); });
      act(() => { window.dispatchEvent(new Event('online')); });

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });
      expect(result.current.commentsError).toBeTruthy();
    });

    describe('priority flag', () => {
      const oneHit = () => HttpResponse.json({
        hits: [{ objectID: '1001', author: 'user1', comment_text: 'Test', created_at_i: 1000, parent_id: 12345, story_id: 12345 }],
        nbHits: 1, page: 0, nbPages: 1, hitsPerPage: 200,
      });

      // The first comments request hangs, like a fetch stalled by losing the network.
      async function renderWithStalledComments() {
        let stalled = false;
        server.use(
          http.get(`${ALGOLIA_API}/search`, async () => {
            stalled = true;
            await new Promise(() => { /* never settles */ });
            return oneHit();
          })
        );
        const hook = renderHook(
          ({ deferComments }) => useItemWithComments(12345, { initialItem: testItem, deferComments }),
          { wrapper: networkWrapper, initialProps: { deferComments: false } }
        );
        await waitFor(() => expect(stalled).toBe(true));
        expect(isPriorityFetchActive()).toBe(true);
        return hook;
      }

      it('is released when the comments arrive through the reconnect retry', async () => {
        const { result, rerender, unmount } = await renderWithStalledComments();

        server.use(http.get(`${ALGOLIA_API}/search`, oneHit));
        act(() => { window.dispatchEvent(new Event('offline')); });
        act(() => { window.dispatchEvent(new Event('online')); });

        await waitFor(() => expect(result.current.comments).toHaveLength(1));
        expect(isPriorityFetchActive()).toBe(false);

        // A swipe panel two away turns deferred, then unmounts.
        rerender({ deferComments: true });
        unmount();
        expect(isPriorityFetchActive()).toBe(false);
      });

      it('is released when the reconnect retry fails', async () => {
        const { result } = await renderWithStalledComments();

        server.use(http.get(`${ALGOLIA_API}/search`, () => new HttpResponse(null, { status: 500 })));
        act(() => { window.dispatchEvent(new Event('offline')); });
        act(() => { window.dispatchEvent(new Event('online')); });

        await waitFor(() => expect(result.current.commentsError).toBeTruthy());
        expect(isPriorityFetchActive()).toBe(false);
      });

      it('is released when the panel turns deferred before the reconnect retry settles', async () => {
        const { result, rerender } = await renderWithStalledComments();

        let release: (() => void) | undefined;
        server.use(
          http.get(`${ALGOLIA_API}/search`, async () => {
            await new Promise<void>(resolve => { release = resolve; });
            return oneHit();
          })
        );
        act(() => { window.dispatchEvent(new Event('offline')); });
        act(() => { window.dispatchEvent(new Event('online')); });
        await waitFor(() => expect(release).toBeDefined());

        rerender({ deferComments: true });
        expect(isPriorityFetchActive()).toBe(true);

        release!();
        await waitFor(() => expect(result.current.comments).toHaveLength(1));
        expect(isPriorityFetchActive()).toBe(false);
      });
    });
  });

  describe('priority flag for a comment item', () => {
    it('is released once the comment item loads', async () => {
      vi.spyOn(hnSdk, 'readItem').mockResolvedValue({
        id: 1001, by: 'user1', text: 'A comment', time: Math.floor(Date.now() / 1000) - 60, parent: 12345, type: 'comment',
      });

      const { result } = renderHook(() => useItemWithComments(1001));

      await waitFor(() => expect(result.current.item?.type).toBe('comment'));
      expect(isPriorityFetchActive()).toBe(false);
    });
  });

  describe('a poll option', () => {
    it('shows no comments, and releases priority once it loads', async () => {
      vi.spyOn(hnSdk, 'readItem').mockResolvedValue({
        id: 126810, text: 'Yes, ban them', by: 'pg', score: 30, time: 1204403652, type: 'pollopt',
      });
      let commentSearches = 0;
      server.use(
        http.get(`${ALGOLIA_API}/search`, () => {
          commentSearches++;
          return HttpResponse.json({
            hits: [{ objectID: '1001', author: 'user1', comment_text: 'Test', created_at_i: 1000, parent_id: 126810, story_id: 126810 }],
            nbHits: 1,
          });
        }),
      );

      const { result } = renderHook(() => useItemWithComments(126810));

      await waitFor(() => expect(result.current.item?.type).toBe('pollopt'));
      expect(isPriorityFetchActive()).toBe(false);
      // The comments read starts before the item turns out to be an option,
      // and its result goes unused. It shares the option's one read.
      await waitFor(() => expect(commentSearches).toBe(1));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
      expect(result.current.comments).toBeNull();
      expect(getCachedItem(126810)).toBeNull();
      expect(hnSdk.readItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('a poll', () => {
    const pollFirebase: FirebaseItem = {
      id: 126809, title: 'Poll: Ban Polls?', by: 'pg', score: 46, time: 1204403652, descendants: 0,
      parts: [126810, 126811], type: 'poll',
    };
    const pollOptions = [
      { id: 126810, text: 'Yes, ban them', points: 30 },
      { id: 126811, text: 'No, leave them', points: 10 },
    ];
    // How a feed (Algolia) delivers it: no options.
    const feedPoll = createStoryItem({ id: 126809, title: 'Poll: Ban Polls?', author: 'pg', points: 46, commentCount: 0, type: 'poll' });

    beforeEach(() => {
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === pollFirebase.id) return pollFirebase;
        const option = pollOptions.find(o => o.id === Number(id));
        return option ? { id: option.id, text: option.text, score: option.points, by: 'pg', time: 1204403652, poll: 126809, type: 'pollopt' } : null;
      });
    });

    it("takes a feed copy's options from the comments fetch, and caches them", async () => {
      const { result } = renderHook(() => useItemWithComments(126809, { initialItem: feedPoll }));

      await waitFor(() => expect(result.current.commentsLoading).toBe(false));
      expect(result.current.item).toEqual({ ...feedPoll, pollOptions });
      expect(getCachedItem(126809)?.item).toEqual({ ...feedPoll, pollOptions });
    });

    it('takes them from a prefetch that lands after a feed copy mounted', async () => {
      const { result, rerender } = renderHook(
        ({ deferComments }) => useItemWithComments(126809, { initialItem: feedPoll, deferComments }),
        { initialProps: { deferComments: true } },
      );

      await act(async () => {
        setCachedItem(126809, { ...feedPoll, pollOptions }, []);
      });
      rerender({ deferComments: false });

      await waitFor(() => expect(result.current.item).toEqual({ ...feedPoll, pollOptions }));
      expect(hnSdk.readItem).not.toHaveBeenCalled();
    });

    it('reads them again over a fresh cached copy that lacks them, keeping its comments up', async () => {
      setCachedItem(126809, feedPoll, []);

      const { result } = renderHook(() => useItemWithComments(126809));

      expect(result.current.commentsLoading).toBe(false);
      await waitFor(() => expect(result.current.item).toEqual({ ...feedPoll, pollOptions }));
      expect(getCachedItem(126809)?.item).toEqual({ ...feedPoll, pollOptions });
    });

    it('shows them when the comments fail to load, without caching the poll', async () => {
      server.use(http.get(`${ALGOLIA_API}/search`, () => new HttpResponse(null, { status: 503 })));

      const { result } = renderHook(() => useItemWithComments(126809, { initialItem: feedPoll }));

      await waitFor(() => expect(result.current.commentsError).toBe('Failed to fetch comments: 503'));
      expect(result.current.item).toEqual({ ...feedPoll, pollOptions });
      expect(getCachedItem(126809)).toBeNull();
    });

    it('gets them back when a failed load is retried', async () => {
      const readItem = vi.mocked(hnSdk.readItem);
      const read = readItem.getMockImplementation()!;
      readItem.mockRejectedValue(new Error('Offline'));

      const { result } = renderHook(() => useItemWithComments(126809));
      await waitFor(() => expect(result.current.error).toBe('Offline'));

      readItem.mockImplementation(read);
      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.item).toMatchObject({ type: 'poll', pollOptions });
      expect(getCachedItem(126809)?.item).toMatchObject({ type: 'poll', pollOptions });
    });
  });

  describe('refresh loading states', () => {
    it('clears error and commentsError during refresh', async () => {
      vi.spyOn(hnSdk, 'readItem').mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useItemWithComments(12345));

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });

      vi.spyOn(hnSdk, 'readItem').mockResolvedValue(mockFirebaseStory);

      let refreshPromise: Promise<void>;
      act(() => {
        refreshPromise = result.current.refresh();
      });

      // Error must clear synchronously when refresh starts (no flicker).
      expect(result.current.error).toBeNull();
      expect(result.current.itemLoading).toBe(true);
      expect(result.current.commentsLoading).toBe(true);

      await act(async () => { await refreshPromise!; });

      expect(result.current.item).toBeTruthy();
      expect(result.current.error).toBeNull();
    });

    it('sets error when refresh fails', async () => {
      const { result } = renderHook(() =>
        useItemWithComments(12345, { initialItem: testItem })
      );

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      vi.spyOn(hnSdk, 'readItem').mockRejectedValue(new Error('Network error'));

      await act(async () => {
        await result.current.refresh().catch(() => { /* error set internally */ });
      });

      expect(result.current.error).toBeTruthy();
    });

    it('reports a refresh whose comments fail as a comments error', async () => {
      server.use(
        http.get(`${ALGOLIA_API}/search`, () => new HttpResponse(null, { status: 503 }))
      );

      const { result } = renderHook(() => useItemWithComments(12345));

      await waitFor(() => {
        expect(result.current.commentsError).toBeTruthy();
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.commentsError).toBeTruthy();
      expect(result.current.item?.id).toBe(12345);
      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
    });
  });

  describe('retryComments', () => {
    const askItem = createStoryItem({ ...testItem, type: 'ask' });

    beforeEach(() => {
      server.use(
        http.get(`${ALGOLIA_API}/search`, () => new HttpResponse(null, { status: 503 }))
      );
    });

    it('keeps the item when the comments fail again', async () => {
      const { result } = renderHook(() =>
        useItemWithComments(12345, { initialItem: askItem })
      );

      await waitFor(() => {
        expect(result.current.commentsError).toBeTruthy();
      });

      let rejected = false;
      await act(async () => {
        await result.current.retryComments().catch(() => { rejected = true; });
      });

      expect(rejected).toBe(true);
      expect(result.current.error).toBeNull();
      expect(result.current.commentsError).toBeTruthy();
      expect(result.current.item?.type).toBe('ask');
    });

    it('keeps the comments error set while the retry is in flight', async () => {
      const { result } = renderHook(() =>
        useItemWithComments(12345, { initialItem: askItem })
      );

      await waitFor(() => {
        expect(result.current.commentsError).toBeTruthy();
      });

      let retryPromise: Promise<void>;
      act(() => {
        retryPromise = result.current.retryComments();
      });

      expect(result.current.commentsError).toBeTruthy();
      expect(result.current.commentsLoading).toBe(false);

      await act(async () => {
        await retryPromise!.catch(() => { /* still failing */ });
      });
    });

    it('loads the comments and keeps the item type when the retry succeeds', async () => {
      const { result } = renderHook(() =>
        useItemWithComments(12345, { initialItem: askItem })
      );

      await waitFor(() => {
        expect(result.current.commentsError).toBeTruthy();
      });

      server.use(
        http.get(`${ALGOLIA_API}/search`, () => HttpResponse.json({
          hits: [{ objectID: '1001', author: 'user1', comment_text: 'Back', created_at_i: 1000, parent_id: 12345, story_id: 12345 }],
          nbHits: 1, page: 0, nbPages: 1, hitsPerPage: 200,
        }))
      );

      await act(async () => {
        await result.current.retryComments();
      });

      expect(result.current.commentsError).toBeNull();
      expect(result.current.comments).toHaveLength(1);
      expect(result.current.item?.type).toBe('ask');
      expect(getCachedItem(12345)?.comments).toHaveLength(1);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useItemWithComments } from './useItemWithComments';
import { setCachedItem, getCachedItem, ITEM_CACHE_KEY_PREFIX } from '../utils/itemCache';
import { _resetForTesting, isPriorityFetchActive } from '../utils/fetchPriority';
import { server } from '../mocks/server';
import { FIREBASE_API, ALGOLIA_API } from '../config/api';
import type { Comment } from '../types';
import { createStoryItem, createComment } from '../test/factories';
import { NetworkStatusProvider } from '../context/NetworkStatusContext';
import type { ReactNode } from 'react';

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
  });

  afterEach(() => {
    _resetForTesting();
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

    it('returns cached data without fetching', async () => {
      setCachedItem(12345, testItem, testComments, 3);

      const { result } = renderHook(() => useItemWithComments(12345));

      // Cache hit must skip the loading flash entirely.
      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
      expect(result.current.item).toEqual(testItem);
      expect(result.current.comments).toEqual(testComments);
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

  describe('cache sync after prefetch', () => {
    it('syncs comments from cache when prefetch completes after mount', async () => {
      const { result } = renderHook(() =>
        useItemWithComments(12345, {
          initialItem: testItem,
          deferComments: true
        })
      );

      expect(result.current.comments).toBeNull();

      // Background prefetch fills the cache while the hook is still deferred.
      await act(async () => {
        setCachedItem(12345, testItem, testComments, 1);
      });

      const { result: result2, rerender } = renderHook(
        ({ deferComments }) => useItemWithComments(12345, {
          initialItem: testItem,
          deferComments
        }),
        { initialProps: { deferComments: true } }
      );

      expect(getCachedItem(12345)?.comments).toEqual(testComments);

      // Flipping deferComments off must pick up the prefetched cache, not refetch.
      rerender({ deferComments: false });

      await waitFor(() => {
        expect(result2.current.comments).toEqual(testComments);
      });
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
      server.use(
        http.get(`${FIREBASE_API}/item/:id.json`, () => {
          return HttpResponse.json(null, { status: 500 });
        })
      );

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
      setCachedItem(12345, testItem, testComments, 3);

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

    it('aborts fetch when itemId changes', async () => {
      const abortSpy = vi.fn();
      const originalAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function() {
        abortSpy();
        return originalAbort.call(this);
      };

      const { rerender } = renderHook(
        ({ itemId }) => useItemWithComments(itemId),
        { initialProps: { itemId: 12345 } }
      );

      rerender({ itemId: 99999 });

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
      server.use(
        http.get(`${FIREBASE_API}/item/:id.json`, () => {
          return HttpResponse.error();
        })
      );

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

  describe('refresh function', () => {
    it('provides a refresh function that reloads data', async () => {
      const { result } = renderHook(() => useItemWithComments(12345));

      await waitFor(() => {
        expect(result.current.item).toBeTruthy();
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.item).toBeTruthy();
      expect(typeof result.current.refresh).toBe('function');
    });
  });

  describe('loading states', () => {
    it('has separate loading states for item and comments', async () => {
      const { result } = renderHook(() => useItemWithComments(12345));

      expect(result.current.itemLoading).toBe(true);
      expect(result.current.commentsLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.itemLoading).toBe(false);
        expect(result.current.commentsLoading).toBe(false);
      });
    });

    it('combined loading is true only when both are loading', async () => {
      setCachedItem(12345, testItem, null as unknown as Comment[], 0); // Item cached, no comments

      const { result } = renderHook(() => useItemWithComments(12345));

      // `loading` is itemLoading && commentsLoading; one false ⇒ combined false.
      expect(result.current.loading).toBe(false);
    });
  });

  describe('stale cache revalidation', () => {
    it('revalidates when cache is stale', async () => {
      // Hand-write a stale entry (10m old) past the freshness threshold so
      // the hook serves it immediately AND fires a background revalidation.
      const CACHE_KEY = `${ITEM_CACHE_KEY_PREFIX}12345`;
      const staleData = {
        item: testItem,
        comments: testComments,
        timestamp: Date.now() - (10 * 60 * 1000),
        orderedDepth: 3,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(staleData));

      const { result } = renderHook(() => useItemWithComments(12345));

      expect(result.current.item).toEqual(testItem);

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      expect(result.current.item).toBeTruthy();
    });

    it('fetches when cache has no comments', async () => {
      const CACHE_KEY = `${ITEM_CACHE_KEY_PREFIX}12345`;
      const partialData = {
        item: testItem,
        comments: null,
        timestamp: Date.now(),
        orderedDepth: 0,
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

  describe('ordering completion', () => {
    it('completes ordering in background when orderedDepth < 3', async () => {
      // orderedDepth=1 mimics a prefetch that ordered only top-level kids.
      const CACHE_KEY = `${ITEM_CACHE_KEY_PREFIX}12345`;
      const partialOrderData = {
        item: testItem,
        comments: testComments,
        timestamp: Date.now(),
        orderedDepth: 1,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(partialOrderData));

      const { result } = renderHook(() =>
        useItemWithComments(12345, { skipOrderingCompletion: false })
      );

      // Cached data renders synchronously — no loading flash on partial order.
      expect(result.current.item).toEqual(testItem);
      expect(result.current.comments).toEqual(testComments);
      expect(result.current.itemLoading).toBe(false);

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });
    });

    it('skips ordering completion when skipOrderingCompletion is true', async () => {
      const CACHE_KEY = `${ITEM_CACHE_KEY_PREFIX}12345`;
      const partialOrderData = {
        item: testItem,
        comments: testComments,
        timestamp: Date.now(),
        orderedDepth: 1,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(partialOrderData));

      const fetchSpy = vi.fn();
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (...args) => {
        fetchSpy(...args);
        return originalFetch(...args);
      };

      const { result } = renderHook(() =>
        useItemWithComments(12345, { skipOrderingCompletion: true })
      );

      expect(result.current.item).toEqual(testItem);
      expect(result.current.comments).toEqual(testComments);

      // Drain microtasks; skipOrderingCompletion must short-circuit the reorder.
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      expect(result.current.comments).toEqual(testComments);

      globalThis.fetch = originalFetch;
    });

    it('does not trigger ordering completion when orderedDepth >= 3', async () => {
      const CACHE_KEY = `${ITEM_CACHE_KEY_PREFIX}12345`;
      const fullOrderData = {
        item: testItem,
        comments: testComments,
        timestamp: Date.now(),
        orderedDepth: 3,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(fullOrderData));

      const { result } = renderHook(() =>
        useItemWithComments(12345, { skipOrderingCompletion: false })
      );

      expect(result.current.item).toEqual(testItem);
      expect(result.current.comments).toEqual(testComments);
      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);

      // Fully-ordered cache must early-return; no background fetch should fire.
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      expect(result.current.comments).toEqual(testComments);
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
      setCachedItem(12345, testItem, testComments, 3);

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

      setCachedItem(11111, itemA, commentsA, 3);
      setCachedItem(22222, itemB, commentsB, 3);

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

      setCachedItem(33333, itemA, commentsA, 3);

      // 50ms delay simulates a real network round trip so the test can
      // observe the "loading null" intermediate state.
      server.use(
        http.get('https://hacker-news.firebaseio.com/v0/item/44444.json', async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return HttpResponse.json({
            id: 44444,
            type: 'story',
            title: 'Fresh Item B',
            url: 'https://example2.com',
            score: 200,
            by: 'user2',
            time: Math.floor(Date.now() / 1000),
            descendants: 10
          });
        })
      );

      const { result, rerender } = renderHook(
        ({ itemId }) => useItemWithComments(itemId),
        { initialProps: { itemId: 33333 } }
      );

      expect(result.current.item).toEqual(itemA);
      expect(result.current.comments).toEqual(commentsA);

      rerender({ itemId: 44444 });

      // Either null (loading) or the new B is acceptable; the old A is not.
      expect(result.current.item?.id).not.toBe(33333);
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

    it('does not retry when comments already loaded', async () => {
      // Pre-cache so nothing should fetch on reconnect.
      setCachedItem(12345, testItem, testComments, 3);

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

    it('does not retry when commentsError is set (useAutoRetry handles that)', async () => {
      server.use(
        http.get(`${ALGOLIA_API}/search`, () => {
          return HttpResponse.json({ hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 200 });
        })
      );

      const { result } = renderHook(
        () => useItemWithComments(12345, { initialItem: testItem }),
        { wrapper: networkWrapper }
      );

      // Empty list resolves loading; reconnect handler should now treat
      // comments as "not stuck" and stay out of useAutoRetry's territory.
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      const fetchSpy = vi.fn();
      const origFetch = globalThis.fetch;
      globalThis.fetch = (...args) => {
        fetchSpy();
        return origFetch(...args);
      };

      act(() => { window.dispatchEvent(new Event('offline')); });
      act(() => { window.dispatchEvent(new Event('online')); });

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

      // Both endpoints must fail since fetchCommentsForItem touches Firebase too.
      server.use(
        http.get(`${ALGOLIA_API}/search`, () => {
          return new HttpResponse(null, { status: 500 });
        }),
        http.get(`${FIREBASE_API}/item/:id.json`, () => {
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
  });

  describe('refresh loading states', () => {
    it('sets itemLoading and commentsLoading to true during refresh', async () => {
      const { result } = renderHook(() =>
        useItemWithComments(12345, { initialItem: testItem })
      );

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });
      expect(result.current.itemLoading).toBe(false);

      // Slow the refresh fetch so the synchronous loading flip is observable.
      server.use(
        http.get(`${FIREBASE_API}/item/:id.json`, async () => {
          await new Promise(r => setTimeout(r, 200));
          return HttpResponse.json({
            id: 12345, type: 'story', title: 'Sample HN Post', url: 'https://example.com',
            score: 100, by: 'testuser', time: Math.floor(Date.now() / 1000), descendants: 3,
          });
        })
      );

      // Loading states must flip BEFORE the await, not after the fetch settles.
      let refreshPromise: Promise<void>;
      act(() => {
        refreshPromise = result.current.refresh();
      });

      expect(result.current.itemLoading).toBe(true);
      expect(result.current.commentsLoading).toBe(true);

      await act(async () => { await refreshPromise!; });

      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
    });

    it('clears error and commentsError during refresh', async () => {
      server.use(
        http.get(`${FIREBASE_API}/item/:id.json`, () => {
          return HttpResponse.error();
        })
      );

      const { result } = renderHook(() => useItemWithComments(12345));

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });

      server.resetHandlers();

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

      server.use(
        http.get(`${FIREBASE_API}/item/:id.json`, () => {
          return HttpResponse.error();
        })
      );

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.error).toBeTruthy();
    });
  });
});

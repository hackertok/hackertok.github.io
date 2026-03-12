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

      // Initially loading
      expect(result.current.itemLoading).toBe(true);
      expect(result.current.commentsLoading).toBe(true);

      // Wait for fetch to complete
      await waitFor(() => {
        expect(result.current.itemLoading).toBe(false);
      });

      // Should have item data
      expect(result.current.item).toBeTruthy();
      expect(result.current.item!.id).toBe(12345);
    });

    it('returns cached data without fetching', async () => {
      // Pre-populate cache
      setCachedItem(12345, testItem, testComments, 3);

      const { result } = renderHook(() => useItemWithComments(12345));

      // Should immediately have data (no loading)
      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
      expect(result.current.item).toEqual(testItem);
      expect(result.current.comments).toEqual(testComments);
    });

    it('accepts initialItem prop to skip item fetch', async () => {
      const { result } = renderHook(() =>
        useItemWithComments(12345, { initialItem: testItem })
      );

      // Item should not be loading
      expect(result.current.itemLoading).toBe(false);
      expect(result.current.item).toEqual(testItem);

      // Comments should still load
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

      // Item should be available
      expect(result.current.item).toEqual(testItem);

      // Comments should remain null (not loading state)
      expect(result.current.comments).toBeNull();

      // Wait a tick to ensure no async fetch started
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Still no comments
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

      // Initially deferred
      expect(result.current.comments).toBeNull();

      // Change to not deferred
      rerender({ deferComments: false });

      // Should start loading comments
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      // Should have comments now
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

      // Initially no comments (deferred)
      expect(result.current.comments).toBeNull();

      // Simulate prefetch populating cache
      await act(async () => {
        setCachedItem(12345, testItem, testComments, 1);
      });

      // Now change deferComments to false
      const { result: result2, rerender } = renderHook(
        ({ deferComments }) => useItemWithComments(12345, {
          initialItem: testItem,
          deferComments
        }),
        { initialProps: { deferComments: true } }
      );

      // Cache is populated
      expect(getCachedItem(12345)?.comments).toEqual(testComments);

      // Change to not deferred - should sync from cache
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

      // Should register priority during fetch
      // Note: This happens synchronously before async work
      expect(isPriorityFetchActive()).toBe(true);

      // Wait for fetch to complete
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      // Should unregister after success
      expect(isPriorityFetchActive()).toBe(false);
    });

    it('unregisters priority on item fetch failure', async () => {
      // Override handler to return error
      server.use(
        http.get(`${FIREBASE_API}/item/:id.json`, () => {
          return HttpResponse.json(null, { status: 500 });
        })
      );

      expect(isPriorityFetchActive()).toBe(false);

      const { result } = renderHook(() =>
        useItemWithComments(99999, { isPriority: true })
      );

      // Wait for error
      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });

      // Should unregister on failure
      expect(isPriorityFetchActive()).toBe(false);
    });

    it('unregisters priority on comments fetch failure', async () => {
      // Override Algolia handler to return error
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

      // Wait for comments to fail/finish
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      }, { timeout: 3000 });

      // Should unregister after failure
      expect(isPriorityFetchActive()).toBe(false);
    });

    it('unregisters priority on unmount', async () => {
      expect(isPriorityFetchActive()).toBe(false);

      const { unmount } = renderHook(() =>
        useItemWithComments(12345, { isPriority: true })
      );

      // Priority registered
      expect(isPriorityFetchActive()).toBe(true);

      // Unmount while fetch is in progress
      unmount();

      // Should unregister on cleanup
      expect(isPriorityFetchActive()).toBe(false);
    });

    it('does not register priority when cache has comments', async () => {
      // Pre-populate cache with comments
      setCachedItem(12345, testItem, testComments, 3);

      expect(isPriorityFetchActive()).toBe(false);

      renderHook(() =>
        useItemWithComments(12345, { isPriority: true })
      );

      // Should NOT register priority (cache hit)
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

      // Unmount during fetch
      unmount();

      // Should have called abort
      expect(abortSpy).toHaveBeenCalled();

      // Restore
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

      // Change item ID
      rerender({ itemId: 99999 });

      // Should have called abort for previous fetch
      expect(abortSpy).toHaveBeenCalled();

      // Restore
      AbortController.prototype.abort = originalAbort;
    });

    it('does NOT abort when deferComments changes to true (same itemId)', async () => {
      // This tests the mobile swipe scenario:
      // - Item starts fetching at index 0 (deferComments=false)
      // - currentIndex changes, item at index 0 becomes deferred (deferComments=true)
      // - The fetch should NOT be aborted - it should complete in the background

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

      // Fetch started
      expect(result.current.commentsLoading).toBe(true);

      // Change to deferred (simulating swipe away)
      rerender({ deferComments: true });

      // Should NOT abort - same item, just became deferred
      expect(abortSpy).not.toHaveBeenCalled();

      // Restore
      AbortController.prototype.abort = originalAbort;

      // Wait for comments to load (fetch continues in background)
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      // Comments should have loaded (not null/undefined)
      expect(result.current.comments).toBeTruthy();
    });

    it('DOES abort when itemId changes even if new item has deferComments=true', async () => {
      // This tests that we don't incorrectly skip abort when itemId changes
      // If we only check deferComments.current, we'd skip abort even on itemId change

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

      // Change BOTH itemId AND deferComments
      rerender({ itemId: 99999, deferComments: true });

      // Should abort because itemId changed (even though new deferComments is true)
      expect(abortSpy).toHaveBeenCalled();

      // Restore
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
      // Item succeeds but comments fail
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

      // Item should still be available
      expect(result.current.item).toEqual(testItem);
      // No error set (comments failure is non-fatal)
      expect(result.current.error).toBeNull();
    });
  });

  describe('refresh function', () => {
    it('provides a refresh function that reloads data', async () => {
      const { result } = renderHook(() => useItemWithComments(12345));

      await waitFor(() => {
        expect(result.current.item).toBeTruthy();
      });

      // Refresh
      await act(async () => {
        await result.current.refresh();
      });

      // Should still have data (may or may not have changed)
      expect(result.current.item).toBeTruthy();
      expect(typeof result.current.refresh).toBe('function');
    });
  });

  describe('loading states', () => {
    it('has separate loading states for item and comments', async () => {
      const { result } = renderHook(() => useItemWithComments(12345));

      // Both start loading
      expect(result.current.itemLoading).toBe(true);
      expect(result.current.commentsLoading).toBe(true);

      // Wait for completion
      await waitFor(() => {
        expect(result.current.itemLoading).toBe(false);
        expect(result.current.commentsLoading).toBe(false);
      });
    });

    it('combined loading is true only when both are loading', async () => {
      setCachedItem(12345, testItem, null as unknown as Comment[], 0); // Item cached, no comments

      const { result } = renderHook(() => useItemWithComments(12345));

      // Item not loading (cached), comments loading
      // Combined loading = itemLoading && commentsLoading
      expect(result.current.loading).toBe(false); // One is false, so combined is false
    });
  });

  describe('stale cache revalidation', () => {
    it('revalidates when cache is stale', async () => {
      // Create stale cache entry by manipulating timestamp
      const CACHE_KEY = `${ITEM_CACHE_KEY_PREFIX}12345`;
      const staleData = {
        item: testItem,
        comments: testComments,
        timestamp: Date.now() - (10 * 60 * 1000), // 10 minutes ago (stale)
        orderedDepth: 3,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(staleData));

      const { result } = renderHook(() => useItemWithComments(12345));

      // Should show stale data immediately
      expect(result.current.item).toEqual(testItem);

      // But should trigger a revalidation fetch
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      // Should have fresh data after revalidation
      expect(result.current.item).toBeTruthy();
    });

    it('fetches when cache has no comments', async () => {
      // Cache item but no comments
      const CACHE_KEY = `${ITEM_CACHE_KEY_PREFIX}12345`;
      const partialData = {
        item: testItem,
        comments: null,
        timestamp: Date.now(),
        orderedDepth: 0,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(partialData));

      const { result } = renderHook(() => useItemWithComments(12345));

      // Should show item immediately
      expect(result.current.item).toEqual(testItem);
      expect(result.current.itemLoading).toBe(false);

      // Should fetch comments
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      expect(result.current.comments).toBeTruthy();
    });
  });

  describe('ordering completion', () => {
    it('completes ordering in background when orderedDepth < 3', async () => {
      // Cache with partial ordering (orderedDepth=1, like from prefetch)
      const CACHE_KEY = `${ITEM_CACHE_KEY_PREFIX}12345`;
      const partialOrderData = {
        item: testItem,
        comments: testComments,
        timestamp: Date.now(),
        orderedDepth: 1, // Only top-level ordered
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(partialOrderData));

      const { result } = renderHook(() =>
        useItemWithComments(12345, { skipOrderingCompletion: false })
      );

      // Should show cached data immediately (no loading flash)
      expect(result.current.item).toEqual(testItem);
      expect(result.current.comments).toEqual(testComments);
      expect(result.current.itemLoading).toBe(false);

      // Background reorder should complete
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });
    });

    it('skips ordering completion when skipOrderingCompletion is true', async () => {
      // Cache with partial ordering
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

      // Should show cached data
      expect(result.current.item).toEqual(testItem);
      expect(result.current.comments).toEqual(testComments);

      // Wait a tick to confirm no background fetch
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Should NOT have triggered additional fetches for ordering
      // (The hook should return early since skipOrderingCompletion=true)
      expect(result.current.comments).toEqual(testComments);

      globalThis.fetch = originalFetch;
    });

    it('does not trigger ordering completion when orderedDepth >= 3', async () => {
      // Cache with full ordering
      const CACHE_KEY = `${ITEM_CACHE_KEY_PREFIX}12345`;
      const fullOrderData = {
        item: testItem,
        comments: testComments,
        timestamp: Date.now(),
        orderedDepth: 3, // Fully ordered
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(fullOrderData));

      const { result } = renderHook(() =>
        useItemWithComments(12345, { skipOrderingCompletion: false })
      );

      // Should show cached data immediately
      expect(result.current.item).toEqual(testItem);
      expect(result.current.comments).toEqual(testComments);
      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);

      // Should NOT have triggered any fetch (early return)
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Data unchanged
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
      // Cache with number ID
      setCachedItem(12345, testItem, testComments, 3);

      // Access with string ID
      const { result } = renderHook(() => useItemWithComments('12345'));

      // Should get cached data (cache key uses string conversion)
      expect(result.current.item).toEqual(testItem);
      expect(result.current.comments).toEqual(testComments);
    });
  });

  describe('itemId change to cached item', () => {
    it('syncs state when itemId changes to a different fully-cached item', async () => {
      // This tests a critical scenario:
      // 1. User views item A (fully cached)
      // 2. User navigates to item B (also fully cached)
      // 3. State should show B's data, not A's data

      const itemA = createStoryItem({ id: 11111, title: 'Item A', url: 'https://a.com', points: 10, author: 'userA', createdAt: Date.now(), commentCount: 1 });
      const itemB = createStoryItem({ id: 22222, title: 'Item B', url: 'https://b.com', points: 20, author: 'userB', createdAt: Date.now(), commentCount: 2 });
      const commentsA = [createComment({ id: 1001, text: 'Comment for item A', author: 'commenterA' })];
      const commentsB = [createComment({ id: 2001, text: 'Comment for item B', author: 'commenterB' })];

      // Pre-populate cache for BOTH items with full ordering (orderedDepth=3)
      setCachedItem(11111, itemA, commentsA, 3);
      setCachedItem(22222, itemB, commentsB, 3);

      // Render with item A
      const { result, rerender } = renderHook(
        ({ itemId }) => useItemWithComments(itemId),
        { initialProps: { itemId: 11111 } }
      );

      // Should have item A's data
      expect(result.current.item).toEqual(itemA);
      expect(result.current.comments).toEqual(commentsA);
      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);

      // Change to item B (which is also fully cached)
      rerender({ itemId: 22222 });

      // Should now have item B's data, NOT item A's data
      expect(result.current.item).toEqual(itemB);
      expect(result.current.comments).toEqual(commentsB);
      expect(result.current.itemLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
    });
  });

  describe('itemId change to UNCACHED item', () => {
    it('resets state when itemId changes to an uncached item', async () => {
      // Scenario: ItemDetail navigating from cached item A to uncached item B

      const itemA = createStoryItem({ id: 33333, title: 'Cached Item A', url: 'https://example1.com', points: 100, author: 'user1', createdAt: Date.now(), commentCount: 5 });
      const commentsA = [createComment({ id: 3001, text: 'Comment for cached A', author: 'commenter1' })];

      // Only cache item A - item B (44444) is NOT in cache
      setCachedItem(33333, itemA, commentsA, 3);

      // Mock API for item B fetch - add delay to simulate real network
      server.use(
        http.get('https://hacker-news.firebaseio.com/v0/item/44444.json', async () => {
          await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
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

      // Should have item A's data (from cache)
      expect(result.current.item).toEqual(itemA);
      expect(result.current.comments).toEqual(commentsA);

      // Navigate to UNCACHED item B
      rerender({ itemId: 44444 });

      // The item should either be null (loading) or be item B
      // NOT item A
      expect(result.current.item?.id).not.toBe(33333);
    });
  });
});

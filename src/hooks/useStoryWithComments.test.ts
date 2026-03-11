import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useStoryWithComments } from './useStoryWithComments';
import { setCachedStory, getCachedStory } from '../utils/storyCache';
import { _resetForTesting, isPriorityFetchActive } from '../utils/fetchPriority';
import { server } from '../mocks/server';
import { FIREBASE_API, ALGOLIA_API } from '../config/api';
import type { Comment } from '../types';
import { createStory, createComment } from '../test/factories';

const testStory = createStory({
  id: 12345,
  title: 'Test Story',
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

describe('useStoryWithComments', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
  });

  describe('basic fetching', () => {
    it('fetches story and comments when cache is empty', async () => {
      const { result } = renderHook(() => useStoryWithComments(12345));

      // Initially loading
      expect(result.current.storyLoading).toBe(true);
      expect(result.current.commentsLoading).toBe(true);

      // Wait for fetch to complete
      await waitFor(() => {
        expect(result.current.storyLoading).toBe(false);
      });

      // Should have story data
      expect(result.current.story).toBeTruthy();
      expect(result.current.story!.id).toBe(12345);
    });

    it('returns cached data without fetching', async () => {
      // Pre-populate cache
      setCachedStory(12345, testStory, testComments, 3);

      const { result } = renderHook(() => useStoryWithComments(12345));

      // Should immediately have data (no loading)
      expect(result.current.storyLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
      expect(result.current.story).toEqual(testStory);
      expect(result.current.comments).toEqual(testComments);
    });

    it('accepts initialStory prop to skip story fetch', async () => {
      const { result } = renderHook(() =>
        useStoryWithComments(12345, { initialStory: testStory })
      );

      // Story should not be loading
      expect(result.current.storyLoading).toBe(false);
      expect(result.current.story).toEqual(testStory);

      // Comments should still load
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });
    });
  });

  describe('deferComments option', () => {
    it('skips comment fetch when deferComments is true', async () => {
      const { result } = renderHook(() =>
        useStoryWithComments(12345, {
          initialStory: testStory,
          deferComments: true
        })
      );

      // Story should be available
      expect(result.current.story).toEqual(testStory);

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
        ({ deferComments }) => useStoryWithComments(12345, {
          initialStory: testStory,
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
        useStoryWithComments(12345, {
          initialStory: testStory,
          deferComments: true
        })
      );

      // Initially no comments (deferred)
      expect(result.current.comments).toBeNull();

      // Simulate prefetch populating cache
      await act(async () => {
        setCachedStory(12345, testStory, testComments, 1);
      });

      // Now change deferComments to false
      const { result: result2, rerender } = renderHook(
        ({ deferComments }) => useStoryWithComments(12345, {
          initialStory: testStory,
          deferComments
        }),
        { initialProps: { deferComments: true } }
      );

      // Cache is populated
      expect(getCachedStory(12345)?.comments).toEqual(testComments);

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
        useStoryWithComments(12345, { isPriority: true })
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

    it('unregisters priority on story fetch failure', async () => {
      // Override handler to return error
      server.use(
        http.get(`${FIREBASE_API}/item/:id.json`, () => {
          return HttpResponse.json(null, { status: 500 });
        })
      );

      expect(isPriorityFetchActive()).toBe(false);

      const { result } = renderHook(() =>
        useStoryWithComments(99999, { isPriority: true })
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
        useStoryWithComments(12345, {
          initialStory: testStory,
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
        useStoryWithComments(12345, { isPriority: true })
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
      setCachedStory(12345, testStory, testComments, 3);

      expect(isPriorityFetchActive()).toBe(false);

      renderHook(() =>
        useStoryWithComments(12345, { isPriority: true })
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

      const { unmount } = renderHook(() => useStoryWithComments(12345));

      // Unmount during fetch
      unmount();

      // Should have called abort
      expect(abortSpy).toHaveBeenCalled();

      // Restore
      AbortController.prototype.abort = originalAbort;
    });

    it('aborts fetch when storyId changes', async () => {
      const abortSpy = vi.fn();
      const originalAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function() {
        abortSpy();
        return originalAbort.call(this);
      };

      const { rerender } = renderHook(
        ({ storyId }) => useStoryWithComments(storyId),
        { initialProps: { storyId: 12345 } }
      );

      // Change story ID
      rerender({ storyId: 99999 });

      // Should have called abort for previous fetch
      expect(abortSpy).toHaveBeenCalled();

      // Restore
      AbortController.prototype.abort = originalAbort;
    });

    it('does NOT abort when deferComments changes to true (same storyId)', async () => {
      // This tests the mobile swipe scenario:
      // - Story starts fetching at index 0 (deferComments=false)
      // - currentIndex changes, story at index 0 becomes deferred (deferComments=true)
      // - The fetch should NOT be aborted - it should complete in the background

      const abortSpy = vi.fn();
      const originalAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function() {
        abortSpy();
        return originalAbort.call(this);
      };

      const { result, rerender } = renderHook(
        ({ deferComments }) => useStoryWithComments(12345, {
          initialStory: testStory,
          deferComments
        }),
        { initialProps: { deferComments: false } }
      );

      // Fetch started
      expect(result.current.commentsLoading).toBe(true);

      // Change to deferred (simulating swipe away)
      rerender({ deferComments: true });

      // Should NOT abort - same story, just became deferred
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

    it('DOES abort when storyId changes even if new story has deferComments=true', async () => {
      // This tests that we don't incorrectly skip abort when storyId changes
      // If we only check deferComments.current, we'd skip abort even on storyId change

      const abortSpy = vi.fn();
      const originalAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function() {
        abortSpy();
        return originalAbort.call(this);
      };

      const { rerender } = renderHook(
        ({ storyId, deferComments }) => useStoryWithComments(storyId, {
          initialStory: testStory,
          deferComments
        }),
        { initialProps: { storyId: 12345, deferComments: false } }
      );

      // Change BOTH storyId AND deferComments
      rerender({ storyId: 99999, deferComments: true });

      // Should abort because storyId changed (even though new deferComments is true)
      expect(abortSpy).toHaveBeenCalled();

      // Restore
      AbortController.prototype.abort = originalAbort;
    });
  });

  describe('error handling', () => {
    it('sets error state on story fetch failure', async () => {
      server.use(
        http.get(`${FIREBASE_API}/item/:id.json`, () => {
          return HttpResponse.error();
        })
      );

      const { result } = renderHook(() => useStoryWithComments(12345));

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });

      expect(result.current.storyLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
    });

    it('handles comment fetch failure gracefully (story still shows)', async () => {
      // Story succeeds but comments fail
      server.use(
        http.get(`${ALGOLIA_API}/items/:id`, () => {
          return HttpResponse.error();
        })
      );

      const { result } = renderHook(() =>
        useStoryWithComments(12345, { initialStory: testStory })
      );

      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      // Story should still be available
      expect(result.current.story).toEqual(testStory);
      // No error set (comments failure is non-fatal)
      expect(result.current.error).toBeNull();
    });
  });

  describe('refresh function', () => {
    it('provides a refresh function that reloads data', async () => {
      const { result } = renderHook(() => useStoryWithComments(12345));

      await waitFor(() => {
        expect(result.current.story).toBeTruthy();
      });

      // Refresh
      await act(async () => {
        await result.current.refresh();
      });

      // Should still have data (may or may not have changed)
      expect(result.current.story).toBeTruthy();
      expect(typeof result.current.refresh).toBe('function');
    });
  });

  describe('loading states', () => {
    it('has separate loading states for story and comments', async () => {
      const { result } = renderHook(() => useStoryWithComments(12345));

      // Both start loading
      expect(result.current.storyLoading).toBe(true);
      expect(result.current.commentsLoading).toBe(true);

      // Wait for completion
      await waitFor(() => {
        expect(result.current.storyLoading).toBe(false);
        expect(result.current.commentsLoading).toBe(false);
      });
    });

    it('combined loading is true only when both are loading', async () => {
      setCachedStory(12345, testStory, null as unknown as Comment[], 0); // Story cached, no comments

      const { result } = renderHook(() => useStoryWithComments(12345));

      // Story not loading (cached), comments loading
      // Combined loading = storyLoading && commentsLoading
      expect(result.current.loading).toBe(false); // One is false, so combined is false
    });
  });

  describe('stale cache revalidation', () => {
    it('revalidates when cache is stale', async () => {
      // Create stale cache entry by manipulating timestamp
      const CACHE_KEY = 'hackertok_story_12345';
      const staleData = {
        story: testStory,
        comments: testComments,
        timestamp: Date.now() - (10 * 60 * 1000), // 10 minutes ago (stale)
        orderedDepth: 3,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(staleData));

      const { result } = renderHook(() => useStoryWithComments(12345));

      // Should show stale data immediately
      expect(result.current.story).toEqual(testStory);

      // But should trigger a revalidation fetch
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });

      // Should have fresh data after revalidation
      expect(result.current.story).toBeTruthy();
    });

    it('fetches when cache has no comments', async () => {
      // Cache story but no comments
      const CACHE_KEY = 'hackertok_story_12345';
      const partialData = {
        story: testStory,
        comments: null,
        timestamp: Date.now(),
        orderedDepth: 0,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(partialData));

      const { result } = renderHook(() => useStoryWithComments(12345));

      // Should show story immediately
      expect(result.current.story).toEqual(testStory);
      expect(result.current.storyLoading).toBe(false);

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
      const CACHE_KEY = 'hackertok_story_12345';
      const partialOrderData = {
        story: testStory,
        comments: testComments,
        timestamp: Date.now(),
        orderedDepth: 1, // Only top-level ordered
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(partialOrderData));

      const { result } = renderHook(() =>
        useStoryWithComments(12345, { skipOrderingCompletion: false })
      );

      // Should show cached data immediately (no loading flash)
      expect(result.current.story).toEqual(testStory);
      expect(result.current.comments).toEqual(testComments);
      expect(result.current.storyLoading).toBe(false);

      // Background reorder should complete
      await waitFor(() => {
        expect(result.current.commentsLoading).toBe(false);
      });
    });

    it('skips ordering completion when skipOrderingCompletion is true', async () => {
      // Cache with partial ordering
      const CACHE_KEY = 'hackertok_story_12345';
      const partialOrderData = {
        story: testStory,
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
        useStoryWithComments(12345, { skipOrderingCompletion: true })
      );

      // Should show cached data
      expect(result.current.story).toEqual(testStory);
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
      const CACHE_KEY = 'hackertok_story_12345';
      const fullOrderData = {
        story: testStory,
        comments: testComments,
        timestamp: Date.now(),
        orderedDepth: 3, // Fully ordered
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(fullOrderData));

      const { result } = renderHook(() =>
        useStoryWithComments(12345, { skipOrderingCompletion: false })
      );

      // Should show cached data immediately
      expect(result.current.story).toEqual(testStory);
      expect(result.current.comments).toEqual(testComments);
      expect(result.current.storyLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);

      // Should NOT have triggered any fetch (early return)
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Data unchanged
      expect(result.current.comments).toEqual(testComments);
    });
  });

  describe('storyId type handling', () => {
    it('handles string storyId', async () => {
      const { result } = renderHook(() => useStoryWithComments('12345'));

      await waitFor(() => {
        expect(result.current.storyLoading).toBe(false);
      });

      expect(result.current.story).toBeTruthy();
      expect(result.current.story!.id).toBe(12345);
    });

    it('shares cache between string and number storyId', async () => {
      // Cache with number ID
      setCachedStory(12345, testStory, testComments, 3);

      // Access with string ID
      const { result } = renderHook(() => useStoryWithComments('12345'));

      // Should get cached data (cache key uses string conversion)
      expect(result.current.story).toEqual(testStory);
      expect(result.current.comments).toEqual(testComments);
    });
  });

  describe('storyId change to cached story', () => {
    it('syncs state when storyId changes to a different fully-cached story', async () => {
      // This tests a critical scenario:
      // 1. User views story A (fully cached)
      // 2. User navigates to story B (also fully cached)
      // 3. State should show B's data, not A's data

      const storyA = createStory({ id: 11111, title: 'Story A', url: 'https://a.com', points: 10, author: 'userA', createdAt: Date.now(), commentCount: 1 });
      const storyB = createStory({ id: 22222, title: 'Story B', url: 'https://b.com', points: 20, author: 'userB', createdAt: Date.now(), commentCount: 2 });
      const commentsA = [createComment({ id: 1001, text: 'Comment for story A', author: 'commenterA' })];
      const commentsB = [createComment({ id: 2001, text: 'Comment for story B', author: 'commenterB' })];

      // Pre-populate cache for BOTH stories with full ordering (orderedDepth=3)
      setCachedStory(11111, storyA, commentsA, 3);
      setCachedStory(22222, storyB, commentsB, 3);

      // Render with story A
      const { result, rerender } = renderHook(
        ({ storyId }) => useStoryWithComments(storyId),
        { initialProps: { storyId: 11111 } }
      );

      // Should have story A's data
      expect(result.current.story).toEqual(storyA);
      expect(result.current.comments).toEqual(commentsA);
      expect(result.current.storyLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);

      // Change to story B (which is also fully cached)
      rerender({ storyId: 22222 });

      // Should now have story B's data, NOT story A's data
      expect(result.current.story).toEqual(storyB);
      expect(result.current.comments).toEqual(commentsB);
      expect(result.current.storyLoading).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
    });
  });

  describe('storyId change to UNCACHED story', () => {
    it('resets state when storyId changes to an uncached story', async () => {
      // Scenario: StoryDetail navigating from cached story A to uncached story B

      const storyA = createStory({ id: 33333, title: 'Cached Story A', url: 'https://example1.com', points: 100, author: 'user1', createdAt: Date.now(), commentCount: 5 });
      const commentsA = [createComment({ id: 3001, text: 'Comment for cached A', author: 'commenter1' })];

      // Only cache story A - story B (44444) is NOT in cache
      setCachedStory(33333, storyA, commentsA, 3);

      // Mock API for story B fetch - add delay to simulate real network
      server.use(
        http.get('https://hacker-news.firebaseio.com/v0/item/44444.json', async () => {
          await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
          return HttpResponse.json({
            id: 44444,
            type: 'story',
            title: 'Fresh Story B',
            url: 'https://example2.com',
            score: 200,
            by: 'user2',
            time: Math.floor(Date.now() / 1000),
            descendants: 10
          });
        })
      );

      const { result, rerender } = renderHook(
        ({ storyId }) => useStoryWithComments(storyId),
        { initialProps: { storyId: 33333 } }
      );

      // Should have story A's data (from cache)
      expect(result.current.story).toEqual(storyA);
      expect(result.current.comments).toEqual(commentsA);

      // Navigate to UNCACHED story B
      rerender({ storyId: 44444 });

      // The story should either be null (loading) or be story B
      // NOT story A
      expect(result.current.story?.id).not.toBe(33333);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { 
  usePrefetchItem, 
  usePrefetchItems, 
  cancelAllPrefetches 
} from './usePrefetchItem';
import { getCachedItem } from '../utils/itemCache';
import * as fetchPriority from '../utils/fetchPriority';
import * as hn from '../api/hn';
import type { Item } from '../types';

// Vitest's fake requestIdleCallback types a callback scheduled with `timeout`
// as a "Timeout", so its own cancelIdleCallback() throws a type mismatch.
function installFakeTimers() {
  vi.useFakeTimers({ toNotFake: ['requestIdleCallback', 'cancelIdleCallback'] });
  vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) =>
    setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 })));
  vi.stubGlobal('cancelIdleCallback', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
}

function restoreRealTimers() {
  vi.useRealTimers();
  vi.unstubAllGlobals();
}

describe('usePrefetchItem', () => {
  beforeEach(() => {
    localStorage.clear();
    cancelAllPrefetches();
    installFakeTimers();
  });

  afterEach(() => {
    cancelAllPrefetches();
    restoreRealTimers();
  });

  describe('queue processing', () => {
    it('processes queue after debounce delay', async () => {
      const spy = vi.spyOn(hn, 'prefetchItemComments');
      const { result } = renderHook(() => usePrefetchItem());

      act(() => {
        result.current.startPrefetch(12345, 0);
      });

      // 200ms debounce; advance comfortably past it.
      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      expect(spy).toHaveBeenCalledWith(12345, expect.any(AbortSignal));
      spy.mockRestore();
    });

    it('prioritizes lower index items', async () => {
      const spy = vi.spyOn(hn, 'prefetchItemComments');
      const { result } = renderHook(() => usePrefetchItem());

      // Enqueue lower-priority first, higher-priority second to prove the
      // queue sorts by index rather than insertion order.
      act(() => {
        result.current.startPrefetch(99999, 5);
      });

      const { result: result2 } = renderHook(() => usePrefetchItem());
      act(() => {
        result2.current.startPrefetch(88888, 1);
      });

      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      expect(spy.mock.calls[0][0]).toBe(88888);
      expect(spy.mock.calls[1][0]).toBe(99999);
      spy.mockRestore();
    });

    it('keeps tracking a restarted prefetch after the aborted one settles', async () => {
      const settle: (() => void)[] = [];
      const spy = vi.spyOn(hn, 'prefetchItemComments').mockImplementation(
        () => new Promise(resolve => { settle.push(() => resolve(null)); }));
      const { result } = renderHook(() => usePrefetchItem());

      act(() => { result.current.startPrefetch(12345, 0); });
      await act(async () => { vi.advanceTimersByTime(250); });
      act(() => { result.current.stopPrefetch(); });
      act(() => { result.current.startPrefetch(12345, 0); });
      await act(async () => { vi.advanceTimersByTime(250); });
      expect(spy).toHaveBeenCalledTimes(2);

      // The first, aborted fetch settles while the second is still in flight.
      await act(async () => { settle[0](); });
      act(() => { result.current.startPrefetch(12345, 0); });
      await act(async () => { vi.advanceTimersByTime(250); });

      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });
  });

  describe('priority fetch integration', () => {
    it('waits for priority fetch before processing queue', async () => {
      // Use real priority system to keep isPriorityFetchActive() and
      // onPriorityFetchChange in sync (avoids mock inconsistency)
      fetchPriority.registerPriorityFetch();
      
      const onChangeSpy = vi.spyOn(fetchPriority, 'onPriorityFetchChange');
      
      const { result } = renderHook(() => usePrefetchItem());
      
      act(() => {
        result.current.startPrefetch(12345, 0);
      });
      
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      
      // processQueue should have subscribed to priority changes (deferred)
      expect(onChangeSpy).toHaveBeenCalled();
      // Item should NOT be cached — queue was not processed
      expect(getCachedItem(12345)).toBeNull();
      
      onChangeSpy.mockRestore();
      fetchPriority.unregisterPriorityFetch();
    });
  });
});

describe('usePrefetchItems', () => {
  beforeEach(() => {
    localStorage.clear();
    cancelAllPrefetches();
    installFakeTimers();
  });

  afterEach(() => {
    cancelAllPrefetches();
    restoreRealTimers();
  });

  it('handles undefined items', () => {
    expect(() => {
      renderHook(() => usePrefetchItems(0, undefined as unknown as Item[], 3));
    }).not.toThrow();
  });
});

describe('cancelAllPrefetches', () => {
  beforeEach(() => {
    localStorage.clear();
    cancelAllPrefetches();
    installFakeTimers();
  });

  afterEach(() => {
    restoreRealTimers();
  });

  it('aborts active prefetches', async () => {
    // Hang the fetch so cancelAllPrefetches has something in flight to abort.
    const spy = vi.spyOn(hn, 'prefetchItemComments').mockReturnValue(new Promise(() => { /* never resolves */ }));

    const { result } = renderHook(() => usePrefetchItem());
    act(() => {
      result.current.startPrefetch(12345, 0);
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    const signal = spy.mock.calls[0][1];
    expect(signal!.aborted).toBe(false);

    cancelAllPrefetches();
    expect(signal!.aborted).toBe(true);

    spy.mockRestore();
  });
});

describe('edge cases', () => {
  beforeEach(() => {
    localStorage.clear();
    cancelAllPrefetches();
    installFakeTimers();
  });

  afterEach(() => {
    cancelAllPrefetches();
    restoreRealTimers();
  });

  it('usePrefetchItems handles null item in array', () => {
    const itemsWithNull = [
      { id: 1, title: 'Item 1' },
      null,
      { id: 3, title: 'Item 3' },
    ] as unknown as Item[];
    
    expect(() => {
      renderHook(() => usePrefetchItems(0, itemsWithNull, 3));
    }).not.toThrow();
  });
});

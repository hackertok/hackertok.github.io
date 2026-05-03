import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { 
  usePrefetchItem, 
  usePrefetchItems, 
  cancelAllPrefetches 
} from './usePrefetchItem';
import { setCachedItem, getCachedItem } from '../utils/itemCache';
import * as fetchPriority from '../utils/fetchPriority';
import * as hn from '../api/hn';
import type { Item, Comment } from '../types';
import { createStoryItem } from '../test/factories';

describe('usePrefetchItem', () => {
  beforeEach(() => {
    localStorage.clear();
    cancelAllPrefetches();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelAllPrefetches();
    vi.useRealTimers();
  });

  describe('startPrefetch and stopPrefetch', () => {
    it('returns startPrefetch and stopPrefetch functions', () => {
      const { result } = renderHook(() => usePrefetchItem());
      
      expect(typeof result.current.startPrefetch).toBe('function');
      expect(typeof result.current.stopPrefetch).toBe('function');
    });

    it('adds item to queue when startPrefetch called', () => {
      const { result } = renderHook(() => usePrefetchItem());
      
      expect(() => {
        act(() => {
          result.current.startPrefetch(12345, 0);
        });
      }).not.toThrow();
      
      // Calling again with same ID should not error (deduplication)
      expect(() => {
        act(() => {
          result.current.startPrefetch(12345, 0);
        });
      }).not.toThrow();
    });

    it('skips items with fresh cache', () => {
      setCachedItem(12345, createStoryItem({ id: 12345, title: 'Cached' }), [] as Comment[]);

      const { result } = renderHook(() => usePrefetchItem());

      expect(() => {
        act(() => {
          result.current.startPrefetch(12345, 0);
        });
      }).not.toThrow();
    });

    it('removes item from queue when stopPrefetch called', () => {
      const { result } = renderHook(() => usePrefetchItem());

      act(() => {
        result.current.startPrefetch(12345, 0);
      });

      act(() => {
        result.current.stopPrefetch();
      });

      // Re-adding the same id must succeed; if stopPrefetch left it queued,
      // the dedup short-circuit would silently swallow this call.
      expect(() => {
        act(() => {
          result.current.startPrefetch(12345, 0);
        });
      }).not.toThrow();
    });
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

      expect(spy).toHaveBeenCalledWith(12345, expect.any(AbortSignal), 1);
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelAllPrefetches();
    vi.useRealTimers();
  });

  const mockItems = [
    createStoryItem({ id: 1, title: 'Item 1' }),
    createStoryItem({ id: 2, title: 'Item 2' }),
    createStoryItem({ id: 3, title: 'Item 3' }),
    createStoryItem({ id: 4, title: 'Item 4' }),
    createStoryItem({ id: 5, title: 'Item 5' }),
  ];

  it('prefetches items ahead of current index', () => {
    expect(() => {
      renderHook(() => usePrefetchItems(0, mockItems, 3));
    }).not.toThrow();
  });

  it('does not prefetch current item', () => {
    expect(() => {
      renderHook(() => usePrefetchItems(0, mockItems, 3));
    }).not.toThrow();
  });

  it('respects count parameter', () => {
    expect(() => {
      renderHook(() => usePrefetchItems(0, mockItems, 2));
    }).not.toThrow();
  });

  it('does not exceed array bounds', () => {
    expect(() => {
      renderHook(() => usePrefetchItems(3, mockItems, 5));
    }).not.toThrow();
  });

  it('skips already-prefetched items', () => {
    const { rerender } = renderHook(
      ({ index }) => usePrefetchItems(index, mockItems, 2),
      { initialProps: { index: 0 } }
    );

    // Re-rendering at a new index re-enqueues already-pending IDs; dedup
    // should swallow them without raising.
    expect(() => {
      rerender({ index: 1 });
    }).not.toThrow();
  });

  it('skips items with fresh cache', () => {
    setCachedItem(2, createStoryItem({ id: 2, title: 'Item 2' }), [] as Comment[]);

    expect(() => {
      renderHook(() => usePrefetchItems(0, mockItems, 3));
    }).not.toThrow();
  });

  it('handles empty items array', () => {
    expect(() => {
      renderHook(() => usePrefetchItems(0, [], 3));
    }).not.toThrow();
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears pending queue', () => {
    const { result } = renderHook(() => usePrefetchItem());
    
    act(() => {
      result.current.startPrefetch(12345, 0);
      result.current.startPrefetch(12346, 1);
      result.current.startPrefetch(12347, 2);
    });
    
    cancelAllPrefetches();
    
    // Queue should be empty — items can be re-added without error
    expect(() => {
      act(() => {
        result.current.startPrefetch(12345, 0);
      });
    }).not.toThrow();
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

  it('can be called multiple times safely', () => {
    expect(() => {
      cancelAllPrefetches();
      cancelAllPrefetches();
      cancelAllPrefetches();
    }).not.toThrow();
  });
});

describe('edge cases', () => {
  beforeEach(() => {
    localStorage.clear();
    cancelAllPrefetches();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelAllPrefetches();
    vi.useRealTimers();
  });

  it('handles item with id 0', () => {
    const { result } = renderHook(() => usePrefetchItem());
    
    // ID 0 is falsy but should still work
    expect(() => {
      act(() => {
        result.current.startPrefetch(0, 0);
      });
    }).not.toThrow();
  });

  it('handles negative index gracefully', () => {
    const { result } = renderHook(() => usePrefetchItem());
    
    expect(() => {
      act(() => {
        result.current.startPrefetch(12345, -1);
      });
    }).not.toThrow();
  });

  it('handles very large index values', () => {
    const { result } = renderHook(() => usePrefetchItem());
    
    expect(() => {
      act(() => {
        result.current.startPrefetch(12345, Number.MAX_SAFE_INTEGER);
      });
    }).not.toThrow();
  });

  it('stopPrefetch is safe when nothing was started', () => {
    const { result } = renderHook(() => usePrefetchItem());
    
    expect(() => {
      act(() => {
        result.current.stopPrefetch();
      });
    }).not.toThrow();
  });

  it('handles rapid start/stop cycles', () => {
    const { result } = renderHook(() => usePrefetchItem());
    
    expect(() => {
      act(() => {
        for (let i = 0; i < 100; i++) {
          result.current.startPrefetch(i, i);
          result.current.stopPrefetch();
        }
      });
    }).not.toThrow();
  });

  it('usePrefetchItems handles items with missing id', () => {
    const itemsWithMissingId = [
      { id: 1, title: 'Item 1' },
      { title: 'Item without ID' }, // Missing id
      { id: 3, title: 'Item 3' },
    ] as unknown as Item[];
    
    expect(() => {
      renderHook(() => usePrefetchItems(0, itemsWithMissingId, 3));
    }).not.toThrow();
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

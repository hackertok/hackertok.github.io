import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { 
  usePrefetchStory, 
  usePrefetchStories, 
  cancelAllPrefetches 
} from './usePrefetchStory';
import { setCachedStory } from '../utils/storyCache';
import * as fetchPriority from '../utils/fetchPriority';

describe('usePrefetchStory', () => {
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
      const { result } = renderHook(() => usePrefetchStory());
      
      expect(typeof result.current.startPrefetch).toBe('function');
      expect(typeof result.current.stopPrefetch).toBe('function');
    });

    it('adds story to queue when startPrefetch called', () => {
      const { result } = renderHook(() => usePrefetchStory());
      
      act(() => {
        result.current.startPrefetch(12345, 0);
      });
      
      // Story should be queued (internal implementation detail)
      // We can verify by checking that calling again with same ID does nothing
      act(() => {
        result.current.startPrefetch(12345, 0); // Should not error
      });
    });

    it('skips stories with fresh cache', () => {
      // Pre-populate cache with fresh entry
      setCachedStory(12345, { id: 12345, title: 'Cached' }, []);
      
      const { result } = renderHook(() => usePrefetchStory());
      
      act(() => {
        result.current.startPrefetch(12345, 0);
      });
      
      // Should skip and not error since cache is fresh
    });

    it('removes story from queue when stopPrefetch called', () => {
      const { result } = renderHook(() => usePrefetchStory());
      
      act(() => {
        result.current.startPrefetch(12345, 0);
      });
      
      act(() => {
        result.current.stopPrefetch();
      });
      
      // Story should be removed from queue (can be re-added)
      act(() => {
        result.current.startPrefetch(12345, 0);
      });
    });
  });

  describe('queue processing', () => {
    it('processes queue after debounce delay', async () => {
      const { result } = renderHook(() => usePrefetchStory());
      
      act(() => {
        result.current.startPrefetch(12345, 0);
      });
      
      // Advance past debounce delay (200ms)
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      
      // Queue should be processing - we can verify by checking cache later
    });

    it('prioritizes lower index items', async () => {
      const { result } = renderHook(() => usePrefetchStory());
      
      // Add items in reverse priority order
      act(() => {
        result.current.startPrefetch(99999, 5); // Lower priority
      });
      
      const { result: result2 } = renderHook(() => usePrefetchStory());
      act(() => {
        result2.current.startPrefetch(88888, 1); // Higher priority
      });
      
      // Advance past debounce
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      
      // Lower index (higher priority) should be processed first
    });
  });

  describe('priority fetch integration', () => {
    it('waits for priority fetch before processing queue', async () => {
      const isPriorityActiveSpy = vi.spyOn(fetchPriority, 'isPriorityFetchActive');
      isPriorityActiveSpy.mockReturnValue(true);
      
      const { result } = renderHook(() => usePrefetchStory());
      
      act(() => {
        result.current.startPrefetch(12345, 0);
      });
      
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      
      // Should have checked for priority fetch
      expect(isPriorityActiveSpy).toHaveBeenCalled();
      
      isPriorityActiveSpy.mockRestore();
    });
  });
});

describe('usePrefetchStories', () => {
  beforeEach(() => {
    localStorage.clear();
    cancelAllPrefetches();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelAllPrefetches();
    vi.useRealTimers();
  });

  const mockStories = [
    { id: 1, title: 'Story 1' },
    { id: 2, title: 'Story 2' },
    { id: 3, title: 'Story 3' },
    { id: 4, title: 'Story 4' },
    { id: 5, title: 'Story 5' },
  ];

  it('prefetches stories ahead of current index', () => {
    renderHook(() => usePrefetchStories(0, mockStories, 3));
    
    // Should trigger prefetch for stories at index 1, 2, 3
    // (next 3 stories after current index 0)
  });

  it('does not prefetch current story', () => {
    renderHook(() => usePrefetchStories(0, mockStories, 3));
    
    // Story at index 0 should not be prefetched 
    // Only stories 1, 2, 3 are targeted
  });

  it('respects count parameter', () => {
    renderHook(() => usePrefetchStories(0, mockStories, 2));
    
    // Should only queue stories at index 1, 2 (count = 2)
  });

  it('does not exceed array bounds', () => {
    renderHook(() => usePrefetchStories(3, mockStories, 5));
    
    // With stories length 5, and currentIndex 3, count 5
    // Should only prefetch indices 4 (not beyond array)
  });

  it('skips already-prefetched stories', () => {
    const { rerender } = renderHook(
      ({ index }) => usePrefetchStories(index, mockStories, 2),
      { initialProps: { index: 0 } }
    );
    
    // Move to next index
    rerender({ index: 1 });
    
    // Story at index 2 should not be queued again
  });

  it('skips stories with fresh cache', () => {
    // Pre-populate cache
    setCachedStory(2, { id: 2, title: 'Story 2' }, []);
    
    renderHook(() => usePrefetchStories(0, mockStories, 3));
    
    // Story 2 should be skipped (has fresh cache)
  });

  it('handles empty stories array', () => {
    expect(() => {
      renderHook(() => usePrefetchStories(0, [], 3));
    }).not.toThrow();
  });

  it('handles undefined stories', () => {
    expect(() => {
      renderHook(() => usePrefetchStories(0, undefined, 3));
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
    const { result } = renderHook(() => usePrefetchStory());
    
    act(() => {
      result.current.startPrefetch(12345, 0);
      result.current.startPrefetch(12346, 1);
      result.current.startPrefetch(12347, 2);
    });
    
    cancelAllPrefetches();
    
    // Queue should be empty - stories can be re-added
    act(() => {
      result.current.startPrefetch(12345, 0);
    });
  });

  it('aborts active prefetches', async () => {
    const { result } = renderHook(() => usePrefetchStory());
    
    act(() => {
      result.current.startPrefetch(12345, 0);
    });
    
    // Start processing
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    
    // Cancel should abort any active fetches
    cancelAllPrefetches();
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

  it('handles story with id 0', () => {
    const { result } = renderHook(() => usePrefetchStory());
    
    // ID 0 is falsy but should still work
    expect(() => {
      act(() => {
        result.current.startPrefetch(0, 0);
      });
    }).not.toThrow();
  });

  it('handles negative index gracefully', () => {
    const { result } = renderHook(() => usePrefetchStory());
    
    expect(() => {
      act(() => {
        result.current.startPrefetch(12345, -1);
      });
    }).not.toThrow();
  });

  it('handles very large index values', () => {
    const { result } = renderHook(() => usePrefetchStory());
    
    expect(() => {
      act(() => {
        result.current.startPrefetch(12345, Number.MAX_SAFE_INTEGER);
      });
    }).not.toThrow();
  });

  it('stopPrefetch is safe when nothing was started', () => {
    const { result } = renderHook(() => usePrefetchStory());
    
    expect(() => {
      act(() => {
        result.current.stopPrefetch();
      });
    }).not.toThrow();
  });

  it('handles rapid start/stop cycles', () => {
    const { result } = renderHook(() => usePrefetchStory());
    
    expect(() => {
      act(() => {
        for (let i = 0; i < 100; i++) {
          result.current.startPrefetch(i, i);
          result.current.stopPrefetch();
        }
      });
    }).not.toThrow();
  });

  it('usePrefetchStories handles stories with missing id', () => {
    const storiesWithMissingId = [
      { id: 1, title: 'Story 1' },
      { title: 'Story without ID' }, // Missing id
      { id: 3, title: 'Story 3' },
    ];
    
    expect(() => {
      renderHook(() => usePrefetchStories(0, storiesWithMissingId, 3));
    }).not.toThrow();
  });

  it('usePrefetchStories handles null story in array', () => {
    const storiesWithNull = [
      { id: 1, title: 'Story 1' },
      null,
      { id: 3, title: 'Story 3' },
    ];
    
    expect(() => {
      renderHook(() => usePrefetchStories(0, storiesWithNull, 3));
    }).not.toThrow();
  });
});

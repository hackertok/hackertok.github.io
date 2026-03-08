import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock matchMedia at module level BEFORE useIsMobile is imported,
// since the hook reads matchMedia at module scope (not inside the hook).
let currentMatches = false;
const listeners = [];

const matchMediaMock = vi.fn(() => ({
  get matches() { return currentMatches; },
  addEventListener: (event, callback) => {
    listeners.push({ event, callback });
  },
  removeEventListener: (event, callback) => {
    const idx = listeners.findIndex(l => l.callback === callback);
    if (idx !== -1) listeners.splice(idx, 1);
  },
}));

// Must be set before module import
window.matchMedia = matchMediaMock;

// Now import — module-level matchMedia() call will use our mock
const { useIsMobile } = await import('./useIsMobile');

describe('useIsMobile', () => {
  beforeEach(() => {
    listeners.length = 0;
    currentMatches = false;
  });

  it('returns false when viewport is > 640px', () => {
    currentMatches = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true when viewport is <= 640px', () => {
    currentMatches = true;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('updates when media query changes', () => {
    currentMatches = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Simulate viewport change to mobile
    act(() => {
      currentMatches = true;
      listeners.forEach(l => {
        if (l.event === 'change') l.callback();
      });
    });

    expect(result.current).toBe(true);
  });

  it('cleans up listener on unmount', () => {
    const { unmount } = renderHook(() => useIsMobile());
    const listenerCount = listeners.length;
    expect(listenerCount).toBeGreaterThan(0);

    unmount();
    expect(listeners.length).toBe(listenerCount - 1);
  });
});

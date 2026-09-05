import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Installed before the import: the module caches its MediaQueryList on first
// use. `currentMatches` is the query's answer, and the query is the desktop side.
let currentMatches = false;
const listeners: (() => void)[] = [];

const matchMediaMock = vi.fn((query: string) => ({
  get matches() { return currentMatches; },
  media: query,
  addEventListener: (_event: string, callback: () => void) => {
    listeners.push(callback);
  },
  removeEventListener: (_event: string, callback: () => void) => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  },
}));

window.matchMedia = matchMediaMock as unknown as typeof window.matchMedia;

const { useIsMobileLayout } = await import('./useIsMobileLayout');

describe('useIsMobileLayout', () => {
  beforeEach(() => {
    listeners.length = 0;
    currentMatches = false;
  });

  it('asks the question `md:` asks, in the units it asks it in', () => {
    // Not `(max-width: 767px)`: the header's chrome is styled by `md:`, so a
    // query that agrees only at a 16px root sizes the row for the wrong one.
    renderHook(() => useIsMobileLayout());
    expect(matchMediaMock).toHaveBeenCalledWith('(min-width: 48rem)');
  });

  it('returns false at md and above', () => {
    currentMatches = true;
    const { result } = renderHook(() => useIsMobileLayout());
    expect(result.current).toBe(false);
  });

  it('returns true below md — mobile is the absence of it, not its own edge', () => {
    currentMatches = false;
    const { result } = renderHook(() => useIsMobileLayout());
    expect(result.current).toBe(true);
  });

  it('updates when the media query changes', () => {
    currentMatches = true;
    const { result } = renderHook(() => useIsMobileLayout());
    expect(result.current).toBe(false);

    act(() => {
      currentMatches = false;
      listeners.forEach(l => l());
    });

    expect(result.current).toBe(true);
  });

  it('cleans up its listener on unmount', () => {
    const { unmount } = renderHook(() => useIsMobileLayout());
    expect(listeners).toHaveLength(1);

    unmount();
    expect(listeners).toHaveLength(0);
  });
});

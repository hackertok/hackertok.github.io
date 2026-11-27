import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Installed before the import: the module caches its MediaQueryList on first
// use. `currentMatches` is the query's answer, and the query is the desktop side.
let currentMatches = false;

const matchMediaMock = vi.fn((query: string) => ({
  get matches() { return currentMatches; },
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

window.matchMedia = matchMediaMock as unknown as typeof window.matchMedia;

const { useIsMobileLayout } = await import('./useIsMobileLayout');

describe('useIsMobileLayout', () => {
  beforeEach(() => {
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
});

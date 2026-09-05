import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const answers = new Map<string, boolean>();
const listeners = new Map<string, (() => void)[]>();

const matchMediaMock = vi.fn((query: string) => ({
  get matches() {
    return answers.get(query) ?? false;
  },
  media: query,
  addEventListener: (_event: string, callback: () => void) => {
    listeners.set(query, [...(listeners.get(query) ?? []), callback]);
  },
  removeEventListener: (_event: string, callback: () => void) => {
    listeners.set(query, (listeners.get(query) ?? []).filter(l => l !== callback));
  },
}));

window.matchMedia = matchMediaMock as unknown as typeof window.matchMedia;

const { useMediaQuery } = await import('./useMediaQuery');

describe('useMediaQuery', () => {
  beforeEach(() => {
    answers.clear();
    listeners.clear();
  });

  afterEach(() => {
    window.matchMedia = matchMediaMock as unknown as typeof window.matchMedia;
  });

  it('answers each query on its own', () => {
    // The cache is keyed by query: one entry for all of them would make
    // `useCanSwipe`'s width and pointer questions share a single answer.
    answers.set('(min-width: 48rem)', true);
    answers.set('(pointer: coarse)', false);

    const wide = renderHook(() => useMediaQuery('(min-width: 48rem)'));
    const coarse = renderHook(() => useMediaQuery('(pointer: coarse)'));

    expect(wide.result.current).toBe(true);
    expect(coarse.result.current).toBe(false);
  });

  it('re-renders on a change to the query it subscribed to', () => {
    answers.set('(min-width: 30rem)', false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 30rem)'));
    expect(result.current).toBe(false);

    act(() => {
      answers.set('(min-width: 30rem)', true);
      (listeners.get('(min-width: 30rem)') ?? []).forEach(l => l());
    });

    expect(result.current).toBe(true);
  });

  it('subscribes once across re-renders, and lets go on unmount', () => {
    // A subscribe callback rebuilt per render would have React tearing the
    // subscription down and back up on every commit.
    const { rerender, unmount } = renderHook(() => useMediaQuery('(min-width: 40rem)'));
    rerender();
    rerender();
    expect(listeners.get('(min-width: 40rem)')).toHaveLength(1);

    unmount();
    expect(listeners.get('(min-width: 40rem)')).toHaveLength(0);
  });

  it('falls back per caller where the question cannot be asked', () => {
    // Unique queries: a cache entry made without `matchMedia` stays null.
    window.matchMedia = undefined as unknown as typeof window.matchMedia;

    const assumed = renderHook(() => useMediaQuery('(min-width: 11rem)', true));
    const denied = renderHook(() => useMediaQuery('(min-width: 12rem)'));

    // `useIsMobileLayout` inverts its query, so a blanket `false` would read as
    // "mobile" for it and "no finger" for `useCanSwipe` — one of them wrong.
    expect(assumed.result.current).toBe(true);
    expect(denied.result.current).toBe(false);
  });
});

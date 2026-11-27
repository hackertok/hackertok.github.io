import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Answers per query, because this hook asks two and they disagree — that is the
// whole point of it. Installed before the import: the module caches one
// MediaQueryList per query on first use.
const answers = new Map<string, boolean>();

const matchMediaMock = vi.fn((query: string) => ({
  get matches() {
    return answers.get(query) ?? false;
  },
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

window.matchMedia = matchMediaMock as unknown as typeof window.matchMedia;

const DESKTOP = '(min-width: 48rem)';
const TOUCH = '(pointer: coarse) and (hover: none)';

const { useCanSwipe } = await import('./useCanSwipe');

describe('useCanSwipe', () => {
  beforeEach(() => {
    answers.clear();
  });

  it('asks for a finger as well as a width', () => {
    renderHook(() => useCanSwipe());
    // Primary-pointer form: `any-pointer` would also catch a touch laptop,
    // whose reader has a mouse and wants the list.
    expect(matchMediaMock).toHaveBeenCalledWith(TOUCH);
    expect(matchMediaMock).toHaveBeenCalledWith(DESKTOP);
  });

  it('mounts the viewer for a finger on a narrow viewport', () => {
    answers.set(DESKTOP, false);
    answers.set(TOUCH, true);
    const { result } = renderHook(() => useCanSwipe());
    expect(result.current).toBe(true);
  });

  it('keeps the list for a mouse, however narrow the window', () => {
    // The regression this hook exists for: the viewer binds touch alone, so a
    // mouse reader who lands in it cannot advance the feed by any means. Width
    // put them there — by a narrowed window, or by a default font size large
    // enough to make 48rem wider than their screen.
    answers.set(DESKTOP, false);
    answers.set(TOUCH, false);
    const { result } = renderHook(() => useCanSwipe());
    expect(result.current).toBe(false);
  });

  it('keeps the list for a finger on a wide viewport', () => {
    answers.set(DESKTOP, true);
    answers.set(TOUCH, true);
    const { result } = renderHook(() => useCanSwipe());
    expect(result.current).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsMobileLayout } from '../hooks/useIsMobileLayout';
import { useCanSwipe } from '../hooks/useCanSwipe';

// One stub in setup.ts answers `matchMedia` for the whole suite, and it used
// to answer `false` to everything. That was harmless while the only width
// question asked was `max-width`, and became a wrong answer the moment
// `useIsMobileLayout` started asking `min-width`: jsdom's window is 1024px
// wide, so a consumer that forgot to mock the hook would have rendered mobile
// inside a desktop-sized window and left whoever debugged it looking at the
// component.
describe('the shared matchMedia stub', () => {
  it('answers a width query from the jsdom viewport', () => {
    expect(window.innerWidth).toBe(1024);
    expect(window.matchMedia('(min-width: 48rem)').matches).toBe(true);
    expect(window.matchMedia('(min-width: 1200px)').matches).toBe(false);
  });

  it('leaves every other question false, as it always did', () => {
    expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(false);
    expect(window.matchMedia('(hover: hover)').matches).toBe(false);
  });

  it('so an unmocked useIsMobileLayout reads desktop, which is what 1024px is', () => {
    const { result } = renderHook(() => useIsMobileLayout());
    expect(result.current).toBe(false);
  });

  it('and an unmocked useCanSwipe reads no finger, which jsdom has none of', () => {
    // Why a test that wants the swipe viewer has to mock the hook: the pointer
    // question is not a width, so the stub answers it `false` and would keep
    // answering `false` at any viewport a test set.
    const { result } = renderHook(() => useCanSwipe());
    expect(result.current).toBe(false);
  });
});

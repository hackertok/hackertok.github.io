import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from './prefersReducedMotion';

const realMatchMedia = window.matchMedia;

function stubMatchMedia(matches: boolean) {
  const mm = vi.fn((query: string) => ({ matches, media: query }));
  window.matchMedia = mm as unknown as typeof window.matchMedia;
  return mm;
}

describe('prefersReducedMotion', () => {
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('returns true when the user prefers reduced motion', () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('returns false when the user has no reduced-motion preference', () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('queries the prefers-reduced-motion: reduce feature each call (live read)', () => {
    const mm = stubMatchMedia(false);
    prefersReducedMotion();
    prefersReducedMotion();
    expect(mm).toHaveBeenCalledTimes(2);
    expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import { enableTouchActiveStates } from './touchActiveStates';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enableTouchActiveStates', () => {
  it('registers a passive touchstart handler on the document, which is what iOS gates :active on', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');

    enableTouchActiveStates();

    // The handler does nothing, so a non-passive one would cost the document its
    // scroll fast path for nothing.
    expect(addEventListener).toHaveBeenCalledWith(
      'touchstart',
      expect.any(Function),
      { passive: true },
    );
  });

  it('does nothing when a touch actually arrives', () => {
    enableTouchActiveStates();

    // Anything this handler did would run on every touch, including mid-swipe.
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    expect(() => document.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
  });
});

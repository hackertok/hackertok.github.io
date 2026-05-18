import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useSwipeScroll } from './useSwipeScroll';
import { ScrollContainerProvider } from '../context/ScrollContainerContext';

// ---- jsdom polyfills ----

let mockScrollY = 0;
Object.defineProperty(window, 'scrollY', { get: () => mockScrollY, configurable: true });
Object.defineProperty(window, 'innerWidth', { value: 375, writable: true, configurable: true });

window.scrollTo = vi.fn((...args: unknown[]) => {
  if (typeof args[0] === 'number') mockScrollY = args[1] as number;
});

// Web Animations API stub (jsdom doesn't implement it)
Element.prototype.animate = vi.fn(() => ({
  onfinish: null,
  cancel: vi.fn(),
  finished: Promise.resolve(),
  playState: 'running',
})) as unknown as typeof Element.prototype.animate;

// matchMedia stub
let reducedMotionValue = false;
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: query.includes('reduced-motion') ? reducedMotionValue : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })),
});

// ---- Touch event helpers ----

function dispatchTouch(el: Element, type: string, clientX: number, clientY: number) {
  const touch = {
    identifier: 1, target: el, clientX, clientY,
    pageX: clientX, pageY: clientY, screenX: clientX, screenY: clientY,
    radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
  };
  const isEnd = type === 'touchend' || type === 'touchcancel';
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: isEnd ? [] : [touch] });
  Object.defineProperty(event, 'changedTouches', { value: [touch] });
  Object.defineProperty(event, 'targetTouches', { value: isEnd ? [] : [touch] });
  el.dispatchEvent(event);
}

const CENTER_X = 187.5;
const CENTER_Y = 333;

/** Dispatch a full swipe gesture synchronously. Velocity is infinite (elapsed ≈ 0). */
function swipeGesture(el: Element, direction: 'left' | 'right', distance: number) {
  const endX = direction === 'left' ? CENTER_X - distance : CENTER_X + distance;
  dispatchTouch(el, 'touchstart', CENTER_X, CENTER_Y);
  dispatchTouch(el, 'touchmove', endX, CENTER_Y);
  dispatchTouch(el, 'touchend', endX, CENTER_Y);
}

// ---- Test harness ----

type HookResult = ReturnType<typeof useSwipeScroll>;
let hookResult: HookResult = null!;

function TestHarness({ itemCount = 3, initialIndex = 0, enabled = true }: {
  itemCount?: number; initialIndex?: number; enabled?: boolean;
}) {
  const result = useSwipeScroll({ itemCount, initialIndex, enabled });
  // eslint-disable-next-line react-hooks/globals
  hookResult = result;
  return createElement('div', { ref: result.containerRef, 'data-testid': 'container' },
    ...Array.from({ length: itemCount }, (_, i) =>
      createElement('div', { key: i, className: 'swipe-snap-panel', 'data-testid': `panel-${i}` }, `Panel ${i}`),
    ),
  );
}

const Wrapper = ({ children }: { children: ReactNode }) =>
  createElement(ScrollContainerProvider, null, children);

// ---- Helpers ----

function getContainer() {
  return document.querySelector<HTMLElement>('[data-testid="container"]')!;
}

function getPanel(index: number) {
  return document.querySelector<HTMLElement>(`[data-testid="panel-${index}"]`)!;
}

function hasActive(index: number) {
  return getPanel(index).classList.contains('active');
}

// ---- Tests ----

describe('useSwipeScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockScrollY = 0;
    reducedMotionValue = false;
    vi.mocked(window.scrollTo).mockClear();
    vi.mocked(Element.prototype.animate).mockClear();
    document.documentElement.className = '';
    document.body.className = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -- Initialization --

  describe('initialization', () => {
    it('returns initial currentIndex and activates the correct panel', () => {
      render(createElement(TestHarness, { initialIndex: 1 }), { wrapper: Wrapper });

      expect(hookResult.currentIndex).toBe(1);
      expect(hasActive(0)).toBe(false);
      expect(hasActive(1)).toBe(true);
      expect(hasActive(2)).toBe(false);
    });

    it('sets data-swipe-enabled and history.scrollRestoration', () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      expect(getContainer().dataset.swipeEnabled).toBe('true');
      expect(history.scrollRestoration).toBe('manual');
    });
  });

  // -- Disabled --

  describe('enabled=false', () => {
    it('skips listeners, data-swipe-enabled, and panel activation', () => {
      render(createElement(TestHarness, { enabled: false }), { wrapper: Wrapper });

      expect(getContainer().dataset.swipeEnabled).toBeUndefined();
      expect(hasActive(0)).toBe(false);
      expect(hasActive(1)).toBe(false);
    });
  });

  // -- scrollToIndex --

  describe('scrollToIndex', () => {
    it('switches panel, saves outgoing scroll, restores target scroll, and guards with programmatic flag', () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      // Simulate user scrolled down on panel 0
      mockScrollY = 200;

      act(() => { hookResult.scrollToIndex(1); });

      expect(hasActive(0)).toBe(false);
      expect(hasActive(1)).toBe(true);
      expect(window.scrollTo).toHaveBeenCalledWith(0, 0); // panel 1 has no saved position

      // Programmatic flag is set during the 50ms guard
      expect(hookResult.isScrollingProgrammaticallyRef.current).toBe(true);
      act(() => { vi.advanceTimersByTime(50); });
      expect(hookResult.isScrollingProgrammaticallyRef.current).toBe(false);

      // Navigate back — panel 0's saved position (200) should be restored
      vi.mocked(window.scrollTo).mockClear();
      act(() => { hookResult.scrollToIndex(0); });
      expect(window.scrollTo).toHaveBeenCalledWith(0, 200);
    });
  });

  // -- Touch gestures --

  describe('touch gestures', () => {
    it('forward swipe commits panel change (reduced motion)', async () => {
      reducedMotionValue = true;
      render(createElement(TestHarness), { wrapper: Wrapper });

      expect(hookResult.currentIndex).toBe(0);

      // 150px = 40% of 375 > 25% threshold → commit
      swipeGesture(getContainer(), 'left', 150);

      // Instant swap (reduced motion): panel 1 is active immediately
      expect(hasActive(0)).toBe(false);
      expect(hasActive(1)).toBe(true);

      // Flush deferred setCurrentIndex (setTimeout→MessageChannel→React re-render)
      act(() => { vi.runAllTimers(); });
      // Extra flush: React 18 schedules via MessageChannel (not faked by vi.useFakeTimers)
      await act(async () => { /* flush */ });
      expect(hookResult.currentIndex).toBe(1);
    });

    it('backward swipe commits panel change (reduced motion)', async () => {
      reducedMotionValue = true;
      render(createElement(TestHarness, { initialIndex: 2 }), { wrapper: Wrapper });

      swipeGesture(getContainer(), 'right', 150);

      expect(hasActive(2)).toBe(false);
      expect(hasActive(1)).toBe(true);

      act(() => { vi.runAllTimers(); });
      await act(async () => { /* flush */ });
      expect(hookResult.currentIndex).toBe(1);
    });

    it('preserves per-panel scroll position across swipes (reduced motion)', async () => {
      reducedMotionValue = true;
      render(createElement(TestHarness), { wrapper: Wrapper });

      // User scrolled down on panel 0
      mockScrollY = 200;

      // Swipe forward to panel 1
      vi.mocked(window.scrollTo).mockClear();
      swipeGesture(getContainer(), 'left', 150);

      // Panel 1 starts at top (no saved position)
      expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
      act(() => { vi.runAllTimers(); });
      await act(async () => { /* flush */ });

      // Swipe back to panel 0
      vi.mocked(window.scrollTo).mockClear();
      swipeGesture(getContainer(), 'right', 150);

      // Panel 0's position (200) should be restored
      expect(window.scrollTo).toHaveBeenCalledWith(0, 200);
    });

    it('ignores vertical gestures', () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      const container = getContainer();
      dispatchTouch(container, 'touchstart', CENTER_X, CENTER_Y);
      // Primarily vertical movement: >10px vertical, minimal horizontal
      dispatchTouch(container, 'touchmove', CENTER_X + 2, CENTER_Y + 50);
      dispatchTouch(container, 'touchend', CENTER_X + 2, CENTER_Y + 50);

      expect(hasActive(0)).toBe(true);
      expect(hookResult.currentIndex).toBe(0);
    });

    it('rejects touch during programmatic scroll', () => {
      reducedMotionValue = true;
      render(createElement(TestHarness), { wrapper: Wrapper });

      hookResult.isScrollingProgrammaticallyRef.current = true;
      swipeGesture(getContainer(), 'left', 150);

      expect(hasActive(0)).toBe(true);
      expect(hookResult.currentIndex).toBe(0);
    });

    it('short slow drag cancels without changing panel', () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      const container = getContainer();

      dispatchTouch(container, 'touchstart', CENTER_X, CENTER_Y);
      // Advance 1000ms so velocity is low: 20px / 1000ms = 0.02 < 0.3
      vi.advanceTimersByTime(1000);
      // Small drag: 20px < 25% of 375 = 93.75
      dispatchTouch(container, 'touchmove', CENTER_X - 20, CENTER_Y);
      dispatchTouch(container, 'touchend', CENTER_X - 20, CENTER_Y);

      expect(hasActive(0)).toBe(true);
      expect(hookResult.currentIndex).toBe(0);
      // Snap-back animation was created
      expect(Element.prototype.animate).toHaveBeenCalled();
    });

    it('boundary: swipe backward on first panel stays', () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      // Swipe right (backward) on panel 0 — targetIndex = -1, hasTarget = false
      swipeGesture(getContainer(), 'right', 150);

      expect(hasActive(0)).toBe(true);
      expect(hookResult.currentIndex).toBe(0);
    });

    it('boundary: swipe forward on last panel stays', () => {
      render(createElement(TestHarness, { initialIndex: 2 }), { wrapper: Wrapper });

      // Swipe left (forward) on panel 2 — targetIndex = 3, hasTarget = false
      swipeGesture(getContainer(), 'left', 150);

      expect(hasActive(2)).toBe(true);
      expect(hookResult.currentIndex).toBe(2);
    });

    it('touchcancel is treated the same as touchend', async () => {
      reducedMotionValue = true;
      render(createElement(TestHarness), { wrapper: Wrapper });

      const container = getContainer();
      dispatchTouch(container, 'touchstart', CENTER_X, CENTER_Y);
      dispatchTouch(container, 'touchmove', CENTER_X - 150, CENTER_Y);
      dispatchTouch(container, 'touchcancel', CENTER_X - 150, CENTER_Y);

      expect(hasActive(1)).toBe(true);
      act(() => { vi.runAllTimers(); });
      await act(async () => { /* flush */ });
      expect(hookResult.currentIndex).toBe(1);
    });
  });

  // -- Cleanup --

  describe('cleanup', () => {
    it('removes data-swipe-enabled on unmount', () => {
      const { unmount } = render(createElement(TestHarness), { wrapper: Wrapper });
      const container = getContainer();

      expect(container.dataset.swipeEnabled).toBe('true');

      unmount();

      expect(container.dataset.swipeEnabled).toBeUndefined();
    });
  });
});

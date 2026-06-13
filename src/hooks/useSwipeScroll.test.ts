import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useSwipeScroll } from './useSwipeScroll';
import { ScrollContainerProvider } from '../context/ScrollContainerContext';

// ---- jsdom polyfills ----

let mockScrollY = 0;
let mockScrollHeight = 0;
let mockInnerHeight = 667;
let mockVisualViewportHeight: number | null = null;
Object.defineProperty(window, 'scrollY', { get: () => mockScrollY, configurable: true });
Object.defineProperty(window, 'innerWidth', { value: 375, writable: true, configurable: true });
Object.defineProperty(window, 'innerHeight', { get: () => mockInnerHeight, configurable: true });
Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => mockScrollHeight, configurable: true });

const originalCSSDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
const originalResizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
const originalVisualViewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');

interface MockAnimation {
  onfinish: (() => void) | null;
  cancel: ReturnType<typeof vi.fn>;
  finished: Promise<void>;
  playState: 'running';
}

const createdAnimations: MockAnimation[] = [];
let resizeObserverCallback: ResizeObserverCallback | null = null;
let observedResizeTarget: Element | null = null;
const mockVisualViewport = new EventTarget() as EventTarget & {
  height: number | null;
};

Object.defineProperty(mockVisualViewport, 'height', {
  get: () => mockVisualViewportHeight,
  configurable: true,
});

const updateMockScrollY = (...args: unknown[]) => {
  if (typeof args[0] === 'number') mockScrollY = args[1] as number;
};

window.scrollTo = vi.fn(updateMockScrollY);

// Web Animations API stub (jsdom doesn't implement it)
Element.prototype.animate = vi.fn(() => {
  const animation: MockAnimation = {
    onfinish: null,
    cancel: vi.fn(),
    finished: Promise.resolve(),
    playState: 'running',
  };
  createdAnimations.push(animation);
  return animation;
}) as unknown as typeof Element.prototype.animate;

class ResizeObserverMock {
  observe = vi.fn((target: Element) => {
    observedResizeTarget = target;
  });

  unobserve = vi.fn((target: Element) => {
    if (observedResizeTarget === target) {
      observedResizeTarget = null;
    }
  });

  disconnect = vi.fn(() => {
    observedResizeTarget = null;
  });

  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }
}

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

function dispatchTouch(el: EventTarget, type: string, clientX: number, clientY: number) {
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
  // Touch handlers can synchronously commit a panel swap (reduced-motion path
  // calls setCurrentIndex), so wrap the native dispatch in act() to flush any
  // resulting React state update inside the test's act scope.
  act(() => {
    el.dispatchEvent(event);
  });
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

function activePanelCount() {
  return document.querySelectorAll('[data-testid^="panel-"].active').length;
}

// ---- Tests ----

describe('useSwipeScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockScrollY = 0;
    mockScrollHeight = 0;
    mockInnerHeight = 667;
    mockVisualViewportHeight = null;
    reducedMotionValue = false;
    createdAnimations.length = 0;
    resizeObserverCallback = null;
    observedResizeTarget = null;
    vi.mocked(window.scrollTo).mockImplementation(updateMockScrollY);
    vi.mocked(window.scrollTo).mockClear();
    vi.mocked(Element.prototype.animate).mockClear();
    document.documentElement.className = '';
    document.body.className = '';
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: mockVisualViewport,
    });
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: {
        supports: vi.fn((query: string) => !query.includes('animation-timeline')),
      },
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: ResizeObserverMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalCSSDescriptor) {
      Object.defineProperty(globalThis, 'CSS', originalCSSDescriptor);
    } else {
      delete (globalThis as { CSS?: unknown }).CSS;
    }
    if (originalResizeObserverDescriptor) {
      Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserverDescriptor);
    } else {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    }
    if (originalVisualViewportDescriptor) {
      Object.defineProperty(window, 'visualViewport', originalVisualViewportDescriptor);
    } else {
      Reflect.deleteProperty(window, 'visualViewport');
    }
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

    it('updates the JS scroll indicator when scroll timelines are unavailable', () => {
      mockInnerHeight = 400;
      mockScrollHeight = 1000;
      render(createElement(TestHarness), { wrapper: Wrapper });

      expect(document.body.style.getPropertyValue('--swipe-scroll-progress')).toBe('0');

      mockScrollY = 300;
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });

      expect(Number(document.body.style.getPropertyValue('--swipe-scroll-progress'))).toBeCloseTo(0.5);
    });

    it('uses the visual viewport height for fallback progress and updates on visual viewport resize', () => {
      mockInnerHeight = 400;
      mockVisualViewportHeight = 500;
      mockScrollHeight = 1500;
      mockScrollY = 250;
      render(createElement(TestHarness), { wrapper: Wrapper });

      expect(Number(document.body.style.getPropertyValue('--swipe-scroll-progress'))).toBeCloseTo(0.25);

      mockVisualViewportHeight = 250;
      act(() => {
        window.visualViewport?.dispatchEvent(new Event('resize'));
      });

      expect(Number(document.body.style.getPropertyValue('--swipe-scroll-progress'))).toBeCloseTo(0.2);
    });

    it('updates the JS scroll indicator when the active panel height changes', () => {
      mockInnerHeight = 400;
      mockScrollHeight = 1000;
      render(createElement(TestHarness), { wrapper: Wrapper });

      expect(observedResizeTarget).toBe(getPanel(0));

      mockScrollY = 300;
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });

      expect(Number(document.body.style.getPropertyValue('--swipe-scroll-progress'))).toBeCloseTo(0.5);

      mockScrollHeight = 1600;
      act(() => {
        resizeObserverCallback?.(
          [{ target: getPanel(0) } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      expect(Number(document.body.style.getPropertyValue('--swipe-scroll-progress'))).toBeCloseTo(0.25);
    });

    it('rebinds the ResizeObserver when the active panel changes', () => {
      mockInnerHeight = 400;
      mockScrollHeight = 1000;
      render(createElement(TestHarness), { wrapper: Wrapper });

      expect(observedResizeTarget).toBe(getPanel(0));

      act(() => {
        hookResult.scrollToIndex(1);
      });

      expect(observedResizeTarget).toBe(getPanel(1));
      expect(document.body.style.getPropertyValue('--swipe-scroll-progress')).toBe('0');

      act(() => {
        window.scrollTo(0, 300);
      });

      mockScrollHeight = 1600;
      act(() => {
        resizeObserverCallback?.(
          [{ target: getPanel(1) } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      expect(Number(document.body.style.getPropertyValue('--swipe-scroll-progress'))).toBeCloseTo(0.25);
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

    it('updates currentIndex when the settle animation fires onfinish', async () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      swipeGesture(getContainer(), 'left', 150);

      expect(hookResult.currentIndex).toBe(0);
      expect(createdAnimations[0]).toBeDefined();

      act(() => {
        createdAnimations[0].onfinish?.();
        vi.advanceTimersByTime(16);
      });
      await act(async () => { /* flush */ });

      expect(hookResult.currentIndex).toBe(1);
    });

    it('waits for the settle timeout when onfinish does not fire', async () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      swipeGesture(getContainer(), 'left', 150);

      expect(hookResult.currentIndex).toBe(0);

      act(() => {
        vi.advanceTimersByTime(400);
      });
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

    it('suppresses the scroll indicator during a deep forward panel swap', async () => {
      reducedMotionValue = true;
      mockInnerHeight = 400;
      mockScrollHeight = 5000;
      mockScrollY = 4600;
      render(createElement(TestHarness), { wrapper: Wrapper });

      const activeCountsAtScroll: number[] = [];
      vi.mocked(window.scrollTo).mockImplementation((...args: unknown[]) => {
        activeCountsAtScroll.push(activePanelCount());
        updateMockScrollY(...args);
      });
      vi.mocked(window.scrollTo).mockClear();
      swipeGesture(getContainer(), 'left', 150);

      expect(hasActive(0)).toBe(false);
      expect(hasActive(1)).toBe(true);
      expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
      expect(activeCountsAtScroll).toEqual([1, 1]);
      expect(Number(document.body.style.getPropertyValue('--swipe-scroll-progress'))).toBeCloseTo(0);

      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });

      expect(document.body.classList.contains('is-scrolling')).toBe(false);

      act(() => {
        vi.runAllTimers();
      });
      await act(async () => { /* flush */ });
    });

    it('flags is-swiping for a horizontal swipe but not a vertical gesture', () => {
      // Guards the flicker fix: `is-swiping` (→ sticky) is set ONLY for a horizontal
      // swipe, never a vertical scroll, which must stay `fixed`.
      render(createElement(TestHarness), { wrapper: Wrapper });
      const container = getContainer();

      swipeGesture(container, 'left', 150);
      expect(document.body.classList.contains('is-swiping')).toBe(true);

      dispatchTouch(container, 'touchstart', CENTER_X, CENTER_Y);
      expect(document.body.classList.contains('is-swiping')).toBe(false);
      dispatchTouch(container, 'touchmove', CENTER_X, CENTER_Y - 120);
      dispatchTouch(container, 'touchend', CENTER_X, CENTER_Y - 120);
      expect(document.body.classList.contains('is-swiping')).toBe(false);

      act(() => { vi.runAllTimers(); });
    });

    it('keeps is-swiping set through the commit swap (blink guard)', () => {
      // commitPanelSwap runs after touchend, so `is-swiping` must survive it (clearing
      // at touchend repaints the swap `fixed` → blink, 86e7f98) and only clear on the
      // next touchstart.
      reducedMotionValue = true; // synchronous commit, so the swap definitely runs
      render(createElement(TestHarness), { wrapper: Wrapper });

      swipeGesture(getContainer(), 'left', 150);
      act(() => { vi.runAllTimers(); });
      expect(document.body.classList.contains('is-swiping')).toBe(true);

      dispatchTouch(getContainer(), 'touchstart', CENTER_X, CENTER_Y);
      expect(document.body.classList.contains('is-swiping')).toBe(false);
    });

    it('keeps outgoing panel in flow for non-zero scroll restores', async () => {
      reducedMotionValue = true;
      render(createElement(TestHarness), { wrapper: Wrapper });

      mockScrollY = 200;
      swipeGesture(getContainer(), 'left', 150);
      act(() => { vi.runAllTimers(); });
      await act(async () => { /* flush */ });

      const activeCountsAtScroll: number[] = [];
      vi.mocked(window.scrollTo).mockImplementation((...args: unknown[]) => {
        activeCountsAtScroll.push(activePanelCount());
        updateMockScrollY(...args);
      });
      vi.mocked(window.scrollTo).mockClear();

      swipeGesture(getContainer(), 'right', 150);

      expect(window.scrollTo).toHaveBeenCalledWith(0, 200);
      expect(activeCountsAtScroll[0]).toBe(2);

      act(() => { vi.runAllTimers(); });
      await act(async () => { /* flush */ });
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

    it('short slow drag snaps back instantly without animating (reduced motion)', () => {
      reducedMotionValue = true;
      render(createElement(TestHarness), { wrapper: Wrapper });

      const container = getContainer();

      dispatchTouch(container, 'touchstart', CENTER_X, CENTER_Y);
      // Same sub-threshold + low-velocity drag as the test above, but reduced
      // motion: the cancel must be instant (cleanSlate), with no WAAPI slide —
      // CSS reduced-motion rules can't neutralize an element.animate() call.
      vi.advanceTimersByTime(1000);
      dispatchTouch(container, 'touchmove', CENTER_X - 20, CENTER_Y);
      dispatchTouch(container, 'touchend', CENTER_X - 20, CENTER_Y);

      expect(hasActive(0)).toBe(true);
      expect(hookResult.currentIndex).toBe(0);
      expect(Element.prototype.animate).not.toHaveBeenCalled();
      expect(getPanel(0).style.transform).toBe('');
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

    it('completes a revealed swipe when touchend is delivered to window', async () => {
      reducedMotionValue = true;
      render(createElement(TestHarness), { wrapper: Wrapper });

      const container = getContainer();
      dispatchTouch(container, 'touchstart', CENTER_X, CENTER_Y);
      dispatchTouch(container, 'touchmove', CENTER_X - 150, CENTER_Y);

      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(getPanel(0).classList.contains('dragging')).toBe(true);
      expect(getPanel(1).classList.contains('peeking')).toBe(true);

      dispatchTouch(window, 'touchend', CENTER_X - 150, CENTER_Y);

      act(() => { vi.runAllTimers(); });
      await act(async () => { /* flush */ });

      expect(getPanel(0).classList.contains('dragging')).toBe(false);
      expect(getPanel(1).classList.contains('peeking')).toBe(false);
      expect(hasActive(1)).toBe(true);
      expect(hookResult.currentIndex).toBe(1);
    });

    it('cancels a revealed swipe if document scroll takes over before touchend', () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      const container = getContainer();
      dispatchTouch(container, 'touchstart', CENTER_X, CENTER_Y);
      dispatchTouch(container, 'touchmove', CENTER_X - 150, CENTER_Y);

      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(getPanel(0).classList.contains('dragging')).toBe(true);
      expect(getPanel(1).classList.contains('peeking')).toBe(true);

      mockScrollY = 120;
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });

      expect(getPanel(0).classList.contains('dragging')).toBe(false);
      expect(getPanel(1).classList.contains('peeking')).toBe(false);
      expect(getPanel(0).style.transform).toBe('');
      expect(getPanel(1).style.transform).toBe('');
      expect(hasActive(0)).toBe(true);
      expect(hookResult.currentIndex).toBe(0);
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

    it('clears the reduced-motion deferred commit on unmount', () => {
      reducedMotionValue = true;
      const { unmount } = render(createElement(TestHarness), { wrapper: Wrapper });

      swipeGesture(getContainer(), 'left', 150);

      expect(hasActive(1)).toBe(true);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('scrollable element bail', () => {
    it('yields horizontal gesture to a scrollable <pre> with scroll room', () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      const panel = getPanel(0);

      // Create a <pre> element inside the panel with scrollable content
      const pre = document.createElement('pre');
      panel.appendChild(pre);
      Object.defineProperty(pre, 'scrollLeft', { value: 0, writable: true, configurable: true });
      Object.defineProperty(pre, 'scrollWidth', { value: 800, configurable: true });
      Object.defineProperty(pre, 'clientWidth', { value: 300, configurable: true });

      // Dispatch touch events directly on the <pre> (they bubble to container)
      dispatchTouch(pre, 'touchstart', CENTER_X, CENTER_Y);
      // Horizontal swipe left (drag finger left = deltaX negative = scroll content right)
      dispatchTouch(pre, 'touchmove', CENTER_X - 30, CENTER_Y);
      dispatchTouch(pre, 'touchend', CENTER_X - 30, CENTER_Y);

      // Panel should NOT have transitioned
      expect(hookResult.currentIndex).toBe(0);
      expect(Element.prototype.animate).not.toHaveBeenCalled();
    });

    it('blocks swipe when <pre> has overflow even if no scroll room in drag direction', () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      const container = getContainer();
      const panel = getPanel(0);
      Object.defineProperty(container, 'clientWidth', { value: 375, configurable: true });

      const pre = document.createElement('pre');
      panel.appendChild(pre);
      // Scrolled all the way to the right — no room left to scroll left
      Object.defineProperty(pre, 'scrollLeft', { value: 500, configurable: true });
      Object.defineProperty(pre, 'scrollWidth', { value: 800, configurable: true });
      Object.defineProperty(pre, 'clientWidth', { value: 300, configurable: true });

      dispatchTouch(pre, 'touchstart', CENTER_X, CENTER_Y);
      dispatchTouch(pre, 'touchmove', CENTER_X - 30, CENTER_Y);
      dispatchTouch(pre, 'touchend', CENTER_X - 30, CENTER_Y);

      // Panel should NOT transition — browser handles overscroll bounce
      expect(Element.prototype.animate).not.toHaveBeenCalled();
    });

    it('allows swipe when <pre> has no horizontal overflow', () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      const container = getContainer();
      const panel = getPanel(0);
      Object.defineProperty(container, 'clientWidth', { value: 375, configurable: true });

      const pre = document.createElement('pre');
      panel.appendChild(pre);
      // No overflow — content fits within the element
      Object.defineProperty(pre, 'scrollLeft', { value: 0, configurable: true });
      Object.defineProperty(pre, 'scrollWidth', { value: 300, configurable: true });
      Object.defineProperty(pre, 'clientWidth', { value: 300, configurable: true });

      dispatchTouch(pre, 'touchstart', CENTER_X, CENTER_Y);
      dispatchTouch(pre, 'touchmove', CENTER_X - 30, CENTER_Y);
      dispatchTouch(pre, 'touchend', CENTER_X - 30, CENTER_Y);

      // Panel SHOULD transition since <pre> has no overflow
      expect(Element.prototype.animate).toHaveBeenCalled();
    });

    it('bails unconditionally for elements with data-swipe-ignore', () => {
      render(createElement(TestHarness), { wrapper: Wrapper });

      const panel = getPanel(0);

      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-swipe-ignore', '');
      const child = document.createElement('span');
      wrapper.appendChild(child);
      panel.appendChild(wrapper);

      dispatchTouch(child, 'touchstart', CENTER_X, CENTER_Y);
      dispatchTouch(child, 'touchmove', CENTER_X - 30, CENTER_Y);
      dispatchTouch(child, 'touchend', CENTER_X - 30, CENTER_Y);

      expect(hookResult.currentIndex).toBe(0);
      expect(Element.prototype.animate).not.toHaveBeenCalled();
    });
  });
});

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useScrollContainer } from './useScrollContainer';

const noop = () => undefined;

interface UseSwipeScrollOptions {
  itemCount: number;
  initialIndex?: number;
  enabled?: boolean;
}

interface UseSwipeScrollResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  currentIndex: number;
  currentIndexRef: React.MutableRefObject<number>;
  scrollToIndex: (index: number) => void;
  isScrollingProgrammaticallyRef: React.MutableRefObject<boolean>;
}

export function useSwipeScroll({
  itemCount,
  initialIndex = 0,
  enabled = true,
}: UseSwipeScrollOptions): UseSwipeScrollResult {
  const { enableSwipeMode, disableSwipeMode } = useScrollContainer();

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentIndexRef = useRef(currentIndex);
  const itemCountRef = useRef(itemCount);
  const isScrollingProgrammaticallyRef = useRef(false);
  const isSuppressingScrollIndicatorRef = useRef(false);
  const isDraggingRef = useRef(false);
  const updateScrollIndicatorRef = useRef<() => void>(noop);
  const syncObservedPanelRef = useRef<() => void>(noop);

  // Scroll position map: saves scrollY per panel index
  const scrollMapRef = useRef<Map<number, number>>(new Map());

  useLayoutEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useLayoutEffect(() => {
    itemCountRef.current = itemCount;
  }, [itemCount]);

  useLayoutEffect(() => {
    enableSwipeMode();
    const previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const visualViewport = window.visualViewport;
    const hasNativeScrollTimeline = typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('animation-timeline: scroll()');

    const updateScrollIndicator = () => {
      if (hasNativeScrollTimeline) return;

      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - viewportHeight);
      const progress = maxScroll > 0
        ? Math.min(1, Math.max(0, window.scrollY / maxScroll))
        : 0;

      document.body.style.setProperty('--swipe-scroll-progress', `${progress}`);
    };

    updateScrollIndicatorRef.current = updateScrollIndicator;
    updateScrollIndicator();

    let observedPanel: HTMLElement | null = null;
    let panelResizeObserver: ResizeObserver | null = null;

    const syncObservedPanel = () => {
      if (hasNativeScrollTimeline || !panelResizeObserver) return;

      const nextPanel = Array.from(containerRef.current?.children ?? []).find((panel) =>
        (panel as HTMLElement).classList.contains('active'),
      ) as HTMLElement | undefined;

      if (observedPanel === nextPanel) return;

      if (observedPanel) {
        panelResizeObserver.unobserve(observedPanel);
      }

      observedPanel = nextPanel ?? null;

      if (observedPanel) {
        panelResizeObserver.observe(observedPanel);
        updateScrollIndicator();
      }
    };

    if (!hasNativeScrollTimeline && typeof ResizeObserver === 'function') {
      panelResizeObserver = new ResizeObserver(() => {
        updateScrollIndicator();
      });
    }

    syncObservedPanelRef.current = syncObservedPanel;
    syncObservedPanel();

    // Scroll indicator visibility: show during scroll, fade after idle
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const showIndicator = () => {
      updateScrollIndicator();
      // Don't show indicator during programmatic scrolls (panel switch) or active gestures
      if (
        isScrollingProgrammaticallyRef.current ||
        isSuppressingScrollIndicatorRef.current ||
        isDraggingRef.current
      ) {
        document.body.classList.remove('is-scrolling');
        return;
      }
      document.body.classList.add('is-scrolling');
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        document.body.classList.remove('is-scrolling');
      }, 800);
    };
    const handleResize = () => {
      updateScrollIndicator();
    };
    window.addEventListener('scroll', showIndicator, { passive: true });
    window.addEventListener('resize', handleResize);
    visualViewport?.addEventListener('resize', handleResize);

    return () => {
      disableSwipeMode();
      history.scrollRestoration = previousScrollRestoration;
      window.removeEventListener('scroll', showIndicator);
      window.removeEventListener('resize', handleResize);
      visualViewport?.removeEventListener('resize', handleResize);
      if (scrollTimer) clearTimeout(scrollTimer);
      document.body.classList.remove('is-scrolling');
      document.body.style.removeProperty('--swipe-scroll-progress');
      document.body.style.removeProperty('--swipe-viewport-height');
      isSuppressingScrollIndicatorRef.current = false;
      updateScrollIndicatorRef.current = noop;
      syncObservedPanelRef.current = noop;
      if (observedPanel && panelResizeObserver) {
        panelResizeObserver.unobserve(observedPanel);
      }
      panelResizeObserver?.disconnect();
    };
  }, [enableSwipeMode, disableSwipeMode]);

  // Activate a single panel (toggle .active class). Idempotent.
  const activatePanel = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container?.children[index]) return;
    if ((container.children[index] as HTMLElement).classList.contains('active')) return;

    for (const panel of Array.from(container.children)) {
      (panel as HTMLElement).classList.remove('active');
    }
    (container.children[index] as HTMLElement).classList.add('active');
    syncObservedPanelRef.current();
  }, []);

  const activatePanelAndRestoreScroll = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container?.children[index]) return;

    activatePanel(index);
    // Force reflow so scrollTo sees the new document height (Firefox/WebKit)
    void document.documentElement.scrollHeight;
    const savedY = scrollMapRef.current.get(index) ?? 0;
    window.scrollTo(0, savedY);
    updateScrollIndicatorRef.current();
  }, [activatePanel]);

  // Sync active panel after render (handles new panels, index changes)
  useLayoutEffect(() => {
    if (enabled && !isDraggingRef.current) {
      activatePanel(currentIndex);
    }
  });

  const scrollToIndex = useCallback((index: number) => {
    // Save current scroll position for outgoing panel
    scrollMapRef.current.set(currentIndexRef.current, window.scrollY);

    isScrollingProgrammaticallyRef.current = true;
    currentIndexRef.current = index;
    setCurrentIndex(index);

    // Activate new panel and restore its scroll position
    activatePanelAndRestoreScroll(index);

    setTimeout(() => {
      isScrollingProgrammaticallyRef.current = false;
    }, 50);
  }, [activatePanelAndRestoreScroll]);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    // Initial activation
    activatePanel(currentIndexRef.current);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // --- Animation lifecycle ---
    let runningAnimations: Animation[] = [];
    let pendingTimeouts: ReturnType<typeof setTimeout>[] = [];
    let gestureId = 0;
    let dragFrameId = 0;
    let pendingDragDelta = 0;

    // Pin --swipe-viewport-height to a px value so panel min-height doesn't shift
    // when the URL bar toggles 100dvh. Released ~350ms later (after chrome settles).
    const lockViewportHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.body.style.setProperty('--swipe-viewport-height', `${height}px`);
    };
    const unlockViewportHeight = () => {
      document.body.style.removeProperty('--swipe-viewport-height');
    };
    const suppressScrollIndicatorDuringSwap = () => {
      isSuppressingScrollIndicatorRef.current = true;
      document.body.classList.remove('is-scrolling');

      // Re-enable only after the swap + scrollTo settle, so it can't flash
      // mid-swap. 180ms is empirical (swaps run ~50–250ms).
      const releaseTimeout = setTimeout(() => {
        pendingTimeouts = pendingTimeouts.filter(id => id !== releaseTimeout);
        isSuppressingScrollIndicatorRef.current = false;
        updateScrollIndicatorRef.current();
      }, 180);
      pendingTimeouts.push(releaseTimeout);
    };

    const clearPanelTransitionState = (panel: HTMLElement) => {
      panel.classList.remove('peeking', 'incoming', 'dragging');
      panel.style.transform = '';
      panel.style.opacity = '';
      panel.style.transformOrigin = '';
    };

    // Shared panel-swap. Non-zero restores keep the outgoing panel in flow through
    // scrollTo so Firefox/APZ won't clamp the offset; top restores drop it first to
    // avoid a tall dual-flow layout that flickers fixed chrome.
    const commitPanelSwap = (
      targetPanel: HTMLElement | undefined,
      activePanel: HTMLElement | undefined,
      targetIndex: number,
    ) => {
      suppressScrollIndicatorDuringSwap();
      lockViewportHeight();

      const savedY = scrollMapRef.current.get(targetIndex) ?? 0;
      const restoreAtTop = savedY <= 0;

      if (restoreAtTop && activePanel && activePanel !== targetPanel) {
        activePanel.classList.remove('active');
        clearPanelTransitionState(activePanel);
      }

      // 1. Target into flow.
      if (targetPanel) {
        targetPanel.classList.add('active');
        clearPanelTransitionState(targetPanel);
        targetPanel.scrollTop = 0;
      }
      // 2. Scroll while both panels are in flow (non-zero restores) so FF won't clamp.
      window.scrollTo(0, savedY);
      // 3. Drop the outgoing panel after non-zero restores.
      if (!restoreAtTop && activePanel && activePanel !== targetPanel) {
        activePanel.classList.remove('active');
        clearPanelTransitionState(activePanel);
      }
      // Reflow + re-scroll — backward swipes may have changed content height since savedY.
      void document.documentElement.scrollHeight;
      window.scrollTo(0, savedY);
      updateScrollIndicatorRef.current();
      syncObservedPanelRef.current();
      setCurrentIndex(targetIndex);
      isDraggingRef.current = false;
      // Release viewport height lock after browser chrome animation settles
      const unlockTimeout = setTimeout(() => {
        pendingTimeouts = pendingTimeouts.filter(id => id !== unlockTimeout);
        unlockViewportHeight();
      }, 350);
      pendingTimeouts.push(unlockTimeout);
    };

    const cleanSlate = () => {
      // Cancel any in-progress animations
      runningAnimations.forEach(a => a.cancel());
      runningAnimations = [];
      if (dragFrameId !== 0) {
        cancelAnimationFrame(dragFrameId);
        dragFrameId = 0;
      }
      // Kill stale safety timeouts from previous gestures
      pendingTimeouts.forEach(id => clearTimeout(id));
      pendingTimeouts = [];
      isSuppressingScrollIndicatorRef.current = false;
      // Increment generation so any lingering callbacks become no-ops
      gestureId++;
      // Release any viewport height lock from a previous gesture
      unlockViewportHeight();
      document.body.classList.remove('is-scrolling');
      // Remove residual card-stack classes and inline styles from all panels
      for (const panel of Array.from(container.children) as HTMLElement[]) {
        panel.classList.remove('peeking', 'dragging', 'incoming');
        panel.style.transform = '';
        panel.style.opacity = '';
        panel.style.transformOrigin = '';
        panel.scrollTop = 0;
      }
    };

    // --- Touch-based horizontal swipe handling ---
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let startScrollY = 0;
    let lastClampedDelta = 0;
    let directionLocked = false;
    let isSwiping = false;
    let touchActive = false;
    let lockedDir: 'left' | 'right' | null = null;
    let targetIndex = -1;
    let hasTarget = false;
    let peekRevealed = false;
    let cachedPanelWidth = 0;

    const applyDragFrame = () => {
      dragFrameId = 0;

      if (!touchActive || !isSwiping) return;

      const activePanel = container.children[currentIndexRef.current] as HTMLElement | undefined;
      const clampedDelta = pendingDragDelta;

      if (hasTarget) {
        // Carousel mode: both panels slide together
        const targetPanel = container.children[targetIndex] as HTMLElement | undefined;
        const panelWidth = cachedPanelWidth;

        if (lockedDir === 'left') {
          // Forward: both panels slide left together (carousel)
          if (!peekRevealed && activePanel && targetPanel) {
            peekRevealed = true;
            targetPanel.classList.add('peeking');
            activePanel.classList.add('dragging');
            const savedY = scrollMapRef.current.get(targetIndex) ?? 0;
            targetPanel.scrollTop = savedY;
          }

          if (activePanel) {
            activePanel.style.transform = `translateX(${clampedDelta}px)`;
          }
          if (targetPanel) {
            targetPanel.style.transform = `translateX(${panelWidth + clampedDelta}px)`;
          }
        } else {
          // Back: both panels slide right together (carousel)
          if (!peekRevealed && activePanel && targetPanel) {
            peekRevealed = true;
            targetPanel.classList.add('incoming');
            activePanel.classList.add('dragging');
            const savedY = scrollMapRef.current.get(targetIndex) ?? 0;
            targetPanel.scrollTop = savedY;
          }

          if (activePanel) {
            activePanel.style.transform = `translateX(${clampedDelta}px)`;
          }
          if (targetPanel) {
            targetPanel.style.transform = `translateX(${-panelWidth + clampedDelta}px)`;
          }
        }
      } else {
        // Boundary rubber-band: resistance + cap, no peek
        const dragPx = Math.sign(clampedDelta) * Math.min(Math.abs(clampedDelta) * 0.3, 60);
        if (activePanel) {
          activePanel.style.transform = `translateX(${dragPx}px)`;
        }
      }
    };

    const flushDragFrame = () => {
      if (dragFrameId === 0) return;

      cancelAnimationFrame(dragFrameId);
      applyDragFrame();
    };

    const resetGestureState = () => {
      lastClampedDelta = 0;
      directionLocked = false;
      isSwiping = false;
      touchActive = false;
      lockedDir = null;
      targetIndex = -1;
      hasTarget = false;
      peekRevealed = false;
      cachedPanelWidth = 0;
      pendingDragDelta = 0;
      isDraggingRef.current = false;
    };

    const abortInterruptedSwipe = () => {
      if (!touchActive || !isSwiping) return;

      cleanSlate();
      activatePanel(currentIndexRef.current);
      updateScrollIndicatorRef.current();
      resetGestureState();
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isScrollingProgrammaticallyRef.current) {
        touchActive = false;
        return;
      }

      // Clean slate: cancel stale animations and residual classes
      const hadActiveAnimations = runningAnimations.length > 0;
      cleanSlate();
      // Only restore panel/scroll if an animation was actually interrupted
      // (finishCommit was killed before it could swap .active and scrollTo)
      if (hadActiveAnimations) {
        activatePanelAndRestoreScroll(currentIndexRef.current);
        setCurrentIndex(prev => (prev === currentIndexRef.current ? prev : currentIndexRef.current));
      }

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      startScrollY = window.scrollY;
      lastClampedDelta = 0;
      directionLocked = false;
      isSwiping = false;
      touchActive = true;
      lockedDir = null;
      targetIndex = -1;
      hasTarget = false;
      peekRevealed = false;
      pendingDragDelta = 0;
      isDraggingRef.current = true;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchActive) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;

      if (!directionLocked) {
        if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
          directionLocked = true;
          if (Math.abs(deltaX) > Math.abs(deltaY)) {
            // Check if touch originated in an element that should handle its own horizontal scroll
            const el = touch.target instanceof Element
              ? touch.target
              : (touch.target as Node)?.parentElement;

            // Unconditional bail: developer opt-out via data-swipe-ignore
            if (el?.closest('[data-swipe-ignore]')) {
              touchActive = false;
              isDraggingRef.current = false;
              return;
            }

            // Conditional bail: scrollable <pre> with horizontal overflow
            const scrollable = el?.closest('pre') as HTMLElement | null;
            if (scrollable && scrollable.scrollWidth > scrollable.clientWidth + 1) {
              touchActive = false;
              isDraggingRef.current = false;
              return;
            }

            isSwiping = true;
            // Hide scroll indicator immediately to prevent visible jump during swipe
            document.body.classList.remove('is-scrolling');
            // Cache panel width at lock time to avoid layout reads during drag
            cachedPanelWidth = container.clientWidth || window.innerWidth;
            // Lock direction and determine target
            lockedDir = deltaX < 0 ? 'left' : 'right';
            targetIndex = lockedDir === 'left'
              ? currentIndexRef.current + 1
              : currentIndexRef.current - 1;
            hasTarget = targetIndex >= 0 && targetIndex < itemCountRef.current;
          } else {
            // Vertical gesture — stop tracking
            touchActive = false;
            isDraggingRef.current = false;
            return;
          }
        } else {
          return;
        }
      }

      if (isSwiping) {
        // Clamp deltaX to locked direction (card can't cross center)
        const clampedDelta = lockedDir === 'left'
          ? Math.min(0, deltaX)
          : Math.max(0, deltaX);
        lastClampedDelta = clampedDelta;

        pendingDragDelta = clampedDelta;
        if (dragFrameId === 0) {
          dragFrameId = requestAnimationFrame(applyDragFrame);
        }
      }
    };

    const handleTouchEnd = () => {
      if (!isSwiping || !touchActive) {
        isDraggingRef.current = false;
        return;
      }

      flushDragFrame();
      touchActive = false;

      const oldIndex = currentIndexRef.current;
      const activePanel = container.children[oldIndex] as HTMLElement | undefined;

      const elapsed = Date.now() - startTime;
      const velocity = Math.abs(lastClampedDelta) / elapsed; // px/ms
      const panelWidth = cachedPanelWidth || container.clientWidth || window.innerWidth;

      const shouldCommit = hasTarget &&
        (Math.abs(lastClampedDelta) > panelWidth * 0.25 || velocity > 0.3);

      if (shouldCommit) {
        // --- Commit: fly off + scale up ---
        currentIndexRef.current = targetIndex;
        scrollMapRef.current.set(oldIndex, startScrollY);

        const targetPanel = hasTarget ? container.children[targetIndex] as HTMLElement | undefined : undefined;

        if (reducedMotion) {
          // Instant swap — no animation
          cleanSlate();
          commitPanelSwap(targetPanel, activePanel, targetIndex);
        } else {
          // Velocity-matched duration: animation continues at finger speed.
          // Slight 1.2× boost gives a "pop" feel on release (iOS-like).
          // Floor velocity ensures slow drags still snap crisply.
          const remainingDistance = panelWidth - Math.abs(lastClampedDelta);
          const targetVelocity = Math.max(velocity * 1.2, panelWidth / 250);
          const duration = Math.round(Math.max(50, Math.min(250, remainingDistance / targetVelocity)));
          const animOptions: KeyframeAnimationOptions = {
            duration,
            easing: 'linear',
          };

          const anims: Animation[] = [];

          if (lockedDir === 'left') {
            // Forward commit: both slide left to final position
            if (activePanel) {
              activePanel.style.transform = `translateX(${-panelWidth}px)`;
              const a = activePanel.animate(
                [
                  { transform: `translateX(${lastClampedDelta}px)` },
                  { transform: `translateX(${-panelWidth}px)` },
                ],
                animOptions,
              );
              anims.push(a);
            }
            if (targetPanel) {
              targetPanel.style.transform = 'translateX(0)';
              const a = targetPanel.animate(
                [
                  { transform: `translateX(${panelWidth + lastClampedDelta}px)` },
                  { transform: 'translateX(0)' },
                ],
                animOptions,
              );
              anims.push(a);
            }
          } else {
            // Back commit: both slide right to final position
            if (activePanel) {
              activePanel.style.transform = `translateX(${panelWidth}px)`;
              const a = activePanel.animate(
                [
                  { transform: `translateX(${lastClampedDelta}px)` },
                  { transform: `translateX(${panelWidth}px)` },
                ],
                animOptions,
              );
              anims.push(a);
            }
            if (targetPanel) {
              const currentX = -panelWidth + lastClampedDelta;
              targetPanel.style.transform = 'translateX(0)';
              const a = targetPanel.animate(
                [
                  { transform: `translateX(${currentX}px)` },
                  { transform: 'translateX(0)' },
                ],
                animOptions,
              );
              anims.push(a);
            }
          }

          runningAnimations = anims;

          // Robust cleanup: fires once via onfinish or safety timeout, deferred by one frame
          const myGesture = gestureId;
          let committed = false;
          const finishCommit = () => {
            if (committed || gestureId !== myGesture) return;
            committed = true;
            // Defer to next frame so the final animation state is painted first
            requestAnimationFrame(() => {
              if (gestureId !== myGesture) return;
              runningAnimations = [];
              anims.forEach(a => a.cancel());
              commitPanelSwap(targetPanel, activePanel, targetIndex);
            });
          };

          // Primary: onfinish of first animation
          if (anims.length > 0) {
            anims[0].onfinish = finishCommit;
          }
          // Safety timeout in case onfinish doesn't fire
          pendingTimeouts.push(setTimeout(finishCommit, duration + 100));
        }
      } else {
        // --- Cancel: snap back ---
        const duration = 200;
        const animOptions: KeyframeAnimationOptions = {
          duration,
          easing: 'ease-out',
        };

        const anims: Animation[] = [];

        const targetPanel = hasTarget ? container.children[targetIndex] as HTMLElement | undefined : undefined;

        if (!hasTarget && activePanel && lastClampedDelta !== 0) {
          // Boundary rubber-band cancel — final position is translateX(0)
          const fromTransform = `translateX(${Math.sign(lastClampedDelta) * Math.min(Math.abs(lastClampedDelta) * 0.3, 60)}px)`;
          activePanel.style.transform = 'translateX(0)';
          const a = activePanel.animate(
            [{ transform: fromTransform }, { transform: 'translateX(0)' }],
            animOptions,
          );
          anims.push(a);
        } else if (hasTarget && peekRevealed) {
          if (lockedDir === 'left') {
            // Forward cancel: both slide back to start
            if (activePanel) {
              activePanel.style.transform = 'translateX(0)';
              const a = activePanel.animate(
                [{ transform: `translateX(${lastClampedDelta}px)` }, { transform: 'translateX(0)' }],
                animOptions,
              );
              anims.push(a);
            }
            if (targetPanel) {
              targetPanel.style.transform = `translateX(${panelWidth}px)`;
              const a = targetPanel.animate(
                [{ transform: `translateX(${panelWidth + lastClampedDelta}px)` }, { transform: `translateX(${panelWidth}px)` }],
                animOptions,
              );
              anims.push(a);
            }
          } else {
            // Back cancel: both slide back to start
            if (activePanel) {
              activePanel.style.transform = 'translateX(0)';
              const a = activePanel.animate(
                [{ transform: `translateX(${lastClampedDelta}px)` }, { transform: 'translateX(0)' }],
                animOptions,
              );
              anims.push(a);
            }
            if (targetPanel) {
              targetPanel.style.transform = `translateX(${-panelWidth}px)`;
              const currentX = -panelWidth + lastClampedDelta;
              const a = targetPanel.animate(
                [{ transform: `translateX(${currentX}px)` }, { transform: `translateX(${-panelWidth}px)` }],
                animOptions,
              );
              anims.push(a);
            }
          }
        }

        runningAnimations = anims;

        if (anims.length > 0) {
          const myGesture = gestureId;
          let cancelled = false;
          const finishCancel = () => {
            if (cancelled || gestureId !== myGesture) return;
            cancelled = true;
            requestAnimationFrame(() => {
              if (gestureId !== myGesture) return;
              runningAnimations = [];
              anims.forEach(a => a.cancel());
              cleanSlate();
              isDraggingRef.current = false;
            });
          };
          anims[0].onfinish = finishCancel;
          pendingTimeouts.push(setTimeout(finishCancel, duration + 100));
        } else {
          isDraggingRef.current = false;
        }
      }

      isSwiping = false;
    };

    const handleInterruptedScroll = () => {
      abortInterruptedSwipe();
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    // Mobile browsers can retarget the terminal touch event to the viewport
    // when a fast swipe blends into page scrolling, so finish on window.
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    window.addEventListener('scroll', handleInterruptedScroll, { passive: true });

    // Signal that the gesture system is fully ready (listeners attached).
    // Used by e2e tests to avoid dispatching touch events before handlers exist.
    container.dataset.swipeEnabled = 'true';

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('scroll', handleInterruptedScroll);
      // Cancel any in-flight animations and stale timeouts on cleanup
      runningAnimations.forEach(a => a.cancel());
      if (dragFrameId !== 0) {
        cancelAnimationFrame(dragFrameId);
      }
      pendingTimeouts.forEach(id => clearTimeout(id));
      isSuppressingScrollIndicatorRef.current = false;
      gestureId++;
      delete container.dataset.swipeEnabled;
    };
  }, [enabled, activatePanel, activatePanelAndRestoreScroll]);

  return {
    containerRef,
    currentIndex,
    currentIndexRef,
    scrollToIndex,
    isScrollingProgrammaticallyRef,
  };
}

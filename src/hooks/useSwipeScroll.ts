import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useScrollContainer } from './useScrollContainer';

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
  const isDraggingRef = useRef(false);

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

    // Scroll indicator visibility: show during scroll, fade after idle
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const showIndicator = () => {
      // Don't show indicator during programmatic scrolls (panel switch) or active gestures
      if (isScrollingProgrammaticallyRef.current || isDraggingRef.current) return;
      document.body.classList.add('is-scrolling');
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        document.body.classList.remove('is-scrolling');
      }, 800);
    };
    window.addEventListener('scroll', showIndicator, { passive: true });

    return () => {
      disableSwipeMode();
      history.scrollRestoration = previousScrollRestoration;
      window.removeEventListener('scroll', showIndicator);
      if (scrollTimer) clearTimeout(scrollTimer);
      document.body.classList.remove('is-scrolling');
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
  }, []);

  // Sync active panel after render (handles new panels, index changes)
  useLayoutEffect(() => {
    if (enabled && !isDraggingRef.current) {
      activatePanel(currentIndex);
    }
  });

  const scrollToIndex = useCallback((index: number) => {
    const container = containerRef.current;
    // Save current scroll position for outgoing panel
    scrollMapRef.current.set(currentIndexRef.current, window.scrollY);

    isScrollingProgrammaticallyRef.current = true;
    currentIndexRef.current = index;
    setCurrentIndex(index);

    // Activate new panel and restore its scroll position
    if (container?.children[index]) {
      for (const panel of Array.from(container.children)) {
        (panel as HTMLElement).classList.remove('active');
      }
      (container.children[index] as HTMLElement).classList.add('active');
      // Force reflow so scrollTo sees the new document height (Firefox/WebKit)
      void document.documentElement.scrollHeight;
      const savedY = scrollMapRef.current.get(index) ?? 0;
      window.scrollTo(0, savedY);
    }

    setTimeout(() => {
      isScrollingProgrammaticallyRef.current = false;
    }, 50);
  }, []);

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

    const cleanSlate = () => {
      // Cancel any in-progress animations
      runningAnimations.forEach(a => a.cancel());
      runningAnimations = [];
      // Kill stale safety timeouts from previous gestures
      pendingTimeouts.forEach(id => clearTimeout(id));
      pendingTimeouts = [];
      // Increment generation so any lingering callbacks become no-ops
      gestureId++;
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
        activatePanel(currentIndexRef.current);
        const restoredY = scrollMapRef.current.get(currentIndexRef.current) ?? 0;
        window.scrollTo(0, restoredY);
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

        const activePanel = container.children[currentIndexRef.current] as HTMLElement | undefined;

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
      }
    };

    const handleTouchEnd = () => {
      if (!isSwiping || !touchActive) {
        isDraggingRef.current = false;
        return;
      }
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
          if (activePanel) activePanel.classList.remove('active');
          if (targetPanel) targetPanel.classList.add('active');
          // Force reflow so scrollTo sees the new document height (Firefox/WebKit)
          void document.documentElement.scrollHeight;
          const savedY = scrollMapRef.current.get(targetIndex) ?? 0;
          window.scrollTo(0, savedY);
          isDraggingRef.current = false;
          // Schedule React state update AFTER cleanSlate (which clears pendingTimeouts).
          // Without this, setCurrentIndex is never called and currentIndex stays stale —
          // breaking URL updates and causing the useLayoutEffect to revert the swap.
          setTimeout(() => setCurrentIndex(targetIndex), 0);
        } else {
          // Defer React state update to next macro-task so the browser can paint
          // the first animation frame without being blocked by React reconciliation.
          // currentIndexRef (updated above) is the source of truth for the gesture system.
          // isDraggingRef stays true during animation, guarding the useLayoutEffect.
          pendingTimeouts.push(setTimeout(() => setCurrentIndex(targetIndex), 0));

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
              // Hide old panel
              if (activePanel) {
                activePanel.classList.remove('active', 'dragging');
                activePanel.style.transform = '';
                activePanel.style.opacity = '';
                activePanel.style.transformOrigin = '';
              }
              // Switch target into document flow first (gives document height),
              // then scroll — order matters because scrollTo is clamped by document height
              if (targetPanel) {
                targetPanel.classList.remove('peeking', 'incoming');
                targetPanel.classList.add('active');
                targetPanel.style.transform = '';
                targetPanel.style.opacity = '';
                targetPanel.scrollTop = 0;
              }
              // Force reflow so scrollTo sees the new document height (Firefox/WebKit)
              void document.documentElement.scrollHeight;
              const savedY = scrollMapRef.current.get(targetIndex) ?? 0;
              window.scrollTo(0, savedY);
              isDraggingRef.current = false;
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

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    // Signal that the gesture system is fully ready (listeners attached).
    // Used by e2e tests to avoid dispatching touch events before handlers exist.
    container.dataset.swipeEnabled = 'true';

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      // Cancel any in-flight animations and stale timeouts on cleanup
      runningAnimations.forEach(a => a.cancel());
      pendingTimeouts.forEach(id => clearTimeout(id));
      gestureId++;
      delete container.dataset.swipeEnabled;
    };
  }, [enabled, activatePanel]);

  return {
    containerRef,
    currentIndex,
    currentIndexRef,
    scrollToIndex,
    isScrollingProgrammaticallyRef,
  };
}

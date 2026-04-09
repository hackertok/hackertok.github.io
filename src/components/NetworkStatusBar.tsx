import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

type BarState = 'hidden' | 'offline' | 'back-online' | 'sliding-out';

export function NetworkStatusBar() {
  const { isOnline } = useNetworkStatus();
  const [barState, setBarState] = useState<BarState>('hidden');
  const hasBeenOfflineRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isOnline) {
      hasBeenOfflineRef.current = true;
      setBarState('offline');
    } else if (hasBeenOfflineRef.current) {
      // Just came back online — show "Back online" briefly, then slide out
      setBarState('back-online');
      timerRef.current = setTimeout(() => {
        setBarState('sliding-out');
      }, 1500);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOnline]);

  // Set CSS variable so layout accounts for the bar height
  useLayoutEffect(() => {
    const visible = barState !== 'hidden';
    document.documentElement.style.setProperty('--network-bar-height', visible ? '32px' : '0px');
    return () => {
      document.documentElement.style.setProperty('--network-bar-height', '0px');
    };
  }, [barState]);

  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishExit = useCallback(() => {
    if (exitTimerRef.current) { clearTimeout(exitTimerRef.current); exitTimerRef.current = null; }
    setBarState('hidden');
    hasBeenOfflineRef.current = false;
  }, []);

  useEffect(() => {
    if (barState === 'sliding-out') {
      // Fallback: remove after animation duration in case animationend doesn't fire
      // (e.g., prefers-reduced-motion, jsdom)
      exitTimerRef.current = setTimeout(finishExit, 300);
      return () => { if (exitTimerRef.current) { clearTimeout(exitTimerRef.current); exitTimerRef.current = null; } };
    }
  }, [barState, finishExit]);

  if (barState === 'hidden') return null;

  return (
    <div
      className={`network-status-bar ${barState === 'offline' ? 'network-status-bar-offline' : 'network-status-bar-online'}${barState === 'sliding-out' ? ' network-status-bar-exit' : ''}`}
      role="status"
      aria-live="polite"
      onAnimationEnd={barState === 'sliding-out' ? finishExit : undefined}
    >
      {barState === 'offline' ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h.01" />
            <path d="M8.5 16.429a5 5 0 0 1 7 0" />
            <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
            <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
            <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
            <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
            <path d="m2 2 20 20" />
          </svg>
          No internet connection
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h.01" />
            <path d="M2 8.82a15 15 0 0 1 20 0" />
            <path d="M5 12.859a10 10 0 0 1 14 0" />
            <path d="M8.5 16.429a5 5 0 0 1 7 0" />
          </svg>
          Back online
        </>
      )}
    </div>
  );
}

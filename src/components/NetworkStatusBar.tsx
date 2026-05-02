import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
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
          <WifiOff aria-hidden className="size-4 shrink-0" />
          No internet connection
        </>
      ) : (
        <>
          <Wifi aria-hidden className="size-4 shrink-0" />
          Back online
        </>
      )}
    </div>
  );
}

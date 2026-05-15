import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';

const BACKOFF_DELAYS = [2000, 4000, 8000]; // 2s → 4s → 8s
const RECONNECT_DELAY = 500; // brief stabilization delay after coming back online

interface UseAutoRetryOptions {
  error: string | null;
  retryFn: () => void;
  isOnline: boolean;
  enabled?: boolean;
  maxAttempts?: number;
}

interface UseAutoRetryResult {
  isRetrying: boolean;
  giveUp: boolean;
  resetRetry: () => void;
}

export function useAutoRetry({
  error,
  retryFn,
  isOnline,
  enabled = true,
  maxAttempts = 3,
}: UseAutoRetryOptions): UseAutoRetryResult {
  const [attempts, setAttempts] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const giveUp = attempts >= maxAttempts && !!error;

  // Keep retryFn ref in sync via layout effect (avoids render-phase ref write)
  const retryFnRef = useRef(retryFn);
  useLayoutEffect(() => {
    retryFnRef.current = retryFn;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Track whether a retry-initiated fetch is still in progress.
  // When retryFn is called, we set this true. If error clears while in-flight,
  // we don't reset attempts yet — the fetch may still fail. We only reset
  // attempts when error clears and no retry is in-flight (genuine success).
  const retryInFlightRef = useRef(false);

  const resetRetry = useCallback(() => {
    clearTimer();
    setAttempts(0);
    setIsRetrying(false);
    retryInFlightRef.current = false;
  }, [clearTimer]);

  useLayoutEffect(() => {
    if (!error) {
      clearTimer();
      setIsRetrying(false);
      if (!retryInFlightRef.current) {
        // Genuine success (not a retry clearing error before re-fetching)
        setAttempts(0);
      }
      retryInFlightRef.current = false;
    } else if (enabled && attempts < maxAttempts) {
      // Error appeared and retries remain — mark as retrying BEFORE paint
      // to prevent a 1-frame flash of the error UI (both between online
      // retry cycles AND when an error arrives while offline).
      setIsRetrying(true);
    }
  }, [error, clearTimer, enabled, isOnline, attempts, maxAttempts]);

  useEffect(() => {
    if (!error || !enabled) {
      return;
    }

    // Already given up — wait for manual reset
    if (attempts >= maxAttempts) {
      setIsRetrying(false);
      return;
    }

    if (!isOnline) {
      // Offline: don't count attempts, just mark as retrying.
      // The effect will re-run when isOnline becomes true.
      setIsRetrying(true);
      return;
    }

    setIsRetrying(true);

    const delay = BACKOFF_DELAYS[attempts] ?? BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1];

    clearTimer();
    timerRef.current = setTimeout(() => {
      setAttempts(a => a + 1);
      retryInFlightRef.current = true;
      retryFnRef.current();
    }, delay);

    return clearTimer;
  }, [error, isOnline, enabled, attempts, maxAttempts, clearTimer]);

  // Reconnect: when going from offline→online with an active error, retry immediately
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    const wasOffline = !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;

    if (wasOffline && isOnline && error && enabled && attempts < maxAttempts) {
      clearTimer();
      timerRef.current = setTimeout(() => {
        setAttempts(a => a + 1);
        retryInFlightRef.current = true;
        retryFnRef.current();
      }, RECONNECT_DELAY);
    }
  }, [isOnline, error, enabled, attempts, maxAttempts, clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    isRetrying,
    giveUp,
    resetRetry,
  };
}

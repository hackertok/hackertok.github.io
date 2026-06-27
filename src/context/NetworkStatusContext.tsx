import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { NetworkStatusContext } from './networkStatusDef';

// Upper bound for a single connectivity probe below. A genuine offline read fails
// near-instantly; this only caps a slow-but-live ("lie-fi") link, which we treat as
// inconclusive rather than offline.
const CONNECTIVITY_PROBE_TIMEOUT_MS = 4000;

// While we believe we're offline, re-probe on this cadence so the bar also clears
// once the connection returns: behind a SW-served page `navigator.onLine` can stay
// stuck at `true`, so no `online` event would ever fire to recover.
const CONNECTIVITY_RECHECK_INTERVAL_MS = 3000;

export function NetworkStatusProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  const goOnline = useCallback(() => setIsOnline(true), []);
  const goOffline = useCallback(() => setIsOnline(false), []);

  useEffect(() => {
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [goOnline, goOffline]);

  // Active connectivity verification for offline-capable (service-worker) builds.
  //
  // `navigator.onLine` is unreliable once a SW can serve every request from cache:
  // after a reload while offline, behind a captive portal, or in Chrome DevTools
  // device-mode "Offline" it frequently still reads `true`, and since the page never
  // made an online->offline *transition* no `offline` event fires either. The value
  // latched at mount is then the only signal, so the offline bar stays hidden even
  // though all content came from cache.
  //
  // Verify against the network directly instead: a cache-busted HEAD can't be
  // answered from any HTTP cache (unique URL) and is skipped by the SW fetch handler
  // (GET only), so it truly reaches the network and fails when offline. Keep
  // re-checking while offline, because that same stuck `navigator.onLine` means no
  // `online` event would fire to clear the bar once the link returns.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let disposed = false;
    let recheck: ReturnType<typeof setTimeout> | null = null;
    let inFlight: AbortController | null = null;

    const clearRecheck = () => {
      if (recheck) {
        clearTimeout(recheck);
        recheck = null;
      }
    };

    // true = reachable, false = genuinely offline, null = inconclusive (our own
    // timeout fired on a slow-but-live link, so leave the state unchanged).
    const probe = async (): Promise<boolean | null> => {
      inFlight?.abort();
      const ac = new AbortController();
      inFlight = ac;
      const timeout = setTimeout(() => ac.abort(), CONNECTIVITY_PROBE_TIMEOUT_MS);
      try {
        await fetch(`${import.meta.env.BASE_URL}manifest.webmanifest?_probe=${Date.now()}`, {
          method: 'HEAD',
          cache: 'no-store',
          signal: ac.signal,
        });
        return true;
      } catch (err) {
        return (err as Error).name === 'AbortError' ? null : false;
      } finally {
        clearTimeout(timeout);
        if (inFlight === ac) inFlight = null;
      }
    };

    // Our current belief, tracked locally so a recovery poll keeps running until a
    // probe positively confirms we're back online. An inconclusive probe (null —
    // our own timeout firing on a slow-but-live link) must not silently end the
    // poll and leave the bar stuck offline forever.
    let offline = false;

    const check = async () => {
      // Only a SW-controlled page can make `navigator.onLine` lie; an uncontrolled
      // load came from the network, where it's already trustworthy.
      if (!navigator.serviceWorker.controller) return;
      const reachable = await probe();
      if (disposed) return;
      // null = inconclusive: leave both the React state and our belief untouched.
      if (reachable !== null) {
        offline = !reachable;
        setIsOnline(reachable);
      }
      // Re-arm the poll whenever we still believe we're offline — including after an
      // inconclusive probe — so the bar clears once the link returns (no `online`
      // event fires when `navigator.onLine` is stuck `true`).
      clearRecheck();
      if (offline) {
        recheck = setTimeout(() => void check(), CONNECTIVITY_RECHECK_INTERVAL_MS);
      }
    };

    void check();

    // A first visit isn't controlled until the SW claims it; probe as soon as
    // control arrives so the first offline-capable session is covered too.
    const onControllerChange = () => void check();
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      disposed = true;
      clearRecheck();
      inFlight?.abort();
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return (
    <NetworkStatusContext.Provider value={{ isOnline }}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

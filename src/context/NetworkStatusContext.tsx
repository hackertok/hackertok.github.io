import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { NetworkStatusContext } from './networkStatusDef';

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

  return (
    <NetworkStatusContext.Provider value={{ isOnline }}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

import { useCallback, useSyncExternalStore } from 'react';

// One MediaQueryList per query, built on first use. Building at module load
// would throw where there is no `window` (SSR, a Node-side harness) and would
// also beat the test setup's stub into place; caching keeps the subscription
// alive across every consumer of the same query.
const lists = new Map<string, MediaQueryList | null>();

function getList(query: string): MediaQueryList | null {
  const cached = lists.get(query);
  if (cached !== undefined) return cached;
  const list =
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? null
      : window.matchMedia(query);
  lists.set(query, list);
  return list;
}

/**
 * Subscribes to a media query.
 *
 * `fallback` is the answer where the question cannot be asked at all — no
 * `window`, no `matchMedia`. Each caller picks the side that degrades safely
 * rather than inheriting a blanket `false`, which reads as "no" to one query
 * and "yes" to its negation.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  // Keyed on `query` so React subscribes once instead of on every commit.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = getList(query);
      if (!list) return () => undefined;
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => getList(query)?.matches ?? fallback,
    [query, fallback],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

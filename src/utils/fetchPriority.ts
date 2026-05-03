/**
 * Fetch Priority Coordinator
 * 
 * Ensures user-visible content (current item's comments) loads with highest priority
 * before background prefetching begins. Uses ref-counting to handle multiple mounted
 * components correctly.
 * 
 * Problem solved: On mobile with empty cache, prefetch hooks would compete with
 * the current item's comment fetch for network bandwidth, slowing the user's
 * immediate experience.
 * 
 * Solution: Priority fetches "hold the line" - prefetchers wait until all priority
 * fetches complete before starting their work.
 */

type PriorityListener = (isActive: boolean) => void;

let priorityFetchCount = 0;
const listeners = new Set<PriorityListener>();

function notifyListeners() {
  const isActive = priorityFetchCount > 0;
  listeners.forEach(fn => fn(isActive));
}

/**
 * Register a priority fetch (user-visible content loading). Must be paired
 * with `unregisterPriorityFetch()`.
 */
export function registerPriorityFetch() {
  priorityFetchCount++;
  notifyListeners();
}

/** Call when the priority fetch completes (success or failure). */
export function unregisterPriorityFetch() {
  priorityFetchCount = Math.max(0, priorityFetchCount - 1);
  notifyListeners();
}

export function isPriorityFetchActive() {
  return priorityFetchCount > 0;
}

/** Subscribe to priority fetch state changes; returns an unsubscribe fn. */
export function onPriorityFetchChange(fn: PriorityListener): () => void {
  listeners.add(fn);
  // Immediately notify with current state
  fn(priorityFetchCount > 0);
  return () => listeners.delete(fn);
}

/**
 * Wait for all priority fetches to complete; resolves immediately when none
 * are active.
 */
export function waitForPriorityFetch(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Set up abort handling first (before any early return)
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    
    // Already clear - resolve immediately
    if (priorityFetchCount === 0) {
      resolve();
      return;
    }
    
    // eslint-disable-next-line prefer-const -- must be `let`: used before assignment in onAbort closure
    let unsubscribe: (() => void) | undefined;
    
    const onAbort = () => {
      unsubscribe?.();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    
    signal?.addEventListener('abort', onAbort);
    
    unsubscribe = onPriorityFetchChange((isActive) => {
      if (!isActive) {
        signal?.removeEventListener('abort', onAbort);
        unsubscribe?.();
        resolve();
      }
    });
  });
}

/** Reset priority state (for testing only). */
export function _resetForTesting() {
  priorityFetchCount = 0;
  listeners.clear();
}

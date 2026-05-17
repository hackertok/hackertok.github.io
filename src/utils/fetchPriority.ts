/** Priority coordinator: user-visible fetches block background prefetching. */

type PriorityListener = (isActive: boolean) => void;

let priorityFetchCount = 0;
const listeners = new Set<PriorityListener>();

function notifyListeners() {
  const isActive = priorityFetchCount > 0;
  listeners.forEach(fn => fn(isActive));
}

/** Register a priority fetch. Must pair with `unregisterPriorityFetch`. */
export function registerPriorityFetch() {
  priorityFetchCount++;
  notifyListeners();
}

/** Call when priority fetch completes (success or failure). */
export function unregisterPriorityFetch() {
  priorityFetchCount = Math.max(0, priorityFetchCount - 1);
  notifyListeners();
}

export function isPriorityFetchActive() {
  return priorityFetchCount > 0;
}

/** Subscribe to state changes; returns unsubscribe fn. */
export function onPriorityFetchChange(fn: PriorityListener): () => void {
  listeners.add(fn);
  // Immediately notify with current state
  fn(priorityFetchCount > 0);
  return () => listeners.delete(fn);
}

/** Resolves when no priority fetches are active. */
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

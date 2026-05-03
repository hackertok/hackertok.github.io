/**
 * Scroll-only session restore for infinite-scroll list pages.
 *
 * The main feed (`useInfiniteStories`) needs full session restore — it
 * persists ordered story IDs + pagination cursor + seenIds because the
 * stories themselves are reconstructed from localStorage on rehydrate.
 *
 * Domain/user pages already have a module-level in-memory cache that
 * survives route remounts, so on back-nav the stories are present
 * synchronously. The only thing missing is scroll position. These
 * helpers cover that narrow case without dragging the heavier storage
 * shape along.
 *
 * Storage:
 * - Key:    `scroll:${key}` (caller picks a stable key, e.g. `domain:github.com`)
 * - Value:  `{ scrollY, timestamp }` JSON
 * - TTL:    30 minutes (matches `getListSessionState`'s expiry, so a tab
 *           parked overnight doesn't bounce a user to a stale spot)
 * - Scope:  sessionStorage (per-tab, survives navigations, dies with the tab)
 */

const SCROLL_KEY_PREFIX = 'scroll:';
const SCROLL_TTL_MS = 30 * 60 * 1000;

interface StoredScroll {
  scrollY: number;
  timestamp: number;
}

/**
 * Returns the saved scroll position, or `null` if nothing is stored
 * (or the entry has expired). `null` signals "fresh nav" to the
 * caller; `0` is a valid restored value (user was at the top).
 */
export function readScrollPosition(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(`${SCROLL_KEY_PREFIX}${key}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<StoredScroll>;
    if (typeof data.timestamp !== 'number' || typeof data.scrollY !== 'number') {
      return null;
    }
    if (Date.now() - data.timestamp > SCROLL_TTL_MS) {
      sessionStorage.removeItem(`${SCROLL_KEY_PREFIX}${key}`);
      return null;
    }
    return data.scrollY;
  } catch {
    return null;
  }
}

export function writeScrollPosition(key: string, scrollY: number): void {
  try {
    const data: StoredScroll = { scrollY, timestamp: Date.now() };
    sessionStorage.setItem(`${SCROLL_KEY_PREFIX}${key}`, JSON.stringify(data));
  } catch {
    // sessionStorage might be full or disabled — silently fail, scroll
    // restore is a UX nicety, not a correctness requirement.
  }
}

export function clearScrollPosition(key: string): void {
  try {
    sessionStorage.removeItem(`${SCROLL_KEY_PREFIX}${key}`);
  } catch {
    // Silently fail.
  }
}

/** Scroll position store (sessionStorage, 30-min TTL). */

const SCROLL_KEY_PREFIX = 'scroll:';
const SCROLL_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface StoredScroll {
  scrollY: number;
  timestamp: number;
}

/** Returns saved scrollY or null (expired / absent). */
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
  } catch { /* best-effort */ }
}

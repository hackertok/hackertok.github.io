import type { Item, Comment, FeedType, ListSessionState } from '../types';

/** Item cache (localStorage, stale-while-revalidate). */

export const ITEM_CACHE_KEY_PREFIX = 'item:';
const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes
const CACHE_STALE_AGE = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHED_ITEMS = 60;
// Chromium, Firefox and WebKit give an origin 5,242,880 characters of
// localStorage. Items get up to this much of it, so the feed lists, viewed
// times and theme still fit beside them.
export const MAX_ITEM_CACHE_CHARS = 3_000_000;
const TIMESTAMP_FIELD = '"timestamp":';

export function getCachedItem(itemId: number | string): { item: Item; comments: Comment[]; timestamp: number; isFresh: boolean; orderedDepth: number } | null {
  try {
    const key = `${ITEM_CACHE_KEY_PREFIX}${itemId}`;
    const cached = localStorage.getItem(key);
    
    if (!cached) return null;
    
    const { item, comments, timestamp, orderedDepth } = JSON.parse(cached) as {
      item: Item; comments: Comment[]; timestamp: number; orderedDepth?: number;
    };
    const age = Date.now() - timestamp;
    
    if (age > CACHE_STALE_AGE) {
      localStorage.removeItem(key);
      return null;
    }
    
    return {
      item,
      comments,
      timestamp,
      isFresh: age <= CACHE_MAX_AGE,
      orderedDepth: orderedDepth ?? 3, // Default to full ordering for old caches
    };
  } catch {
    return null;
  }
}

/** `orderedDepth`: 1 = top-level only (prefetch), 3 = full ordering. */
export function setCachedItem(itemId: number | string, item: Item, comments: Comment[], orderedDepth = 3): void {
  const key = `${ITEM_CACHE_KEY_PREFIX}${itemId}`;
  try {
    const value = JSON.stringify({ item, comments, timestamp: Date.now(), orderedDepth });
    // A thread this big would push out half the cache, so it isn't kept.
    if (value.length > MAX_ITEM_CACHE_CHARS / 2) {
      // An older copy would still be read as fresh in its place.
      localStorage.removeItem(key);
      return;
    }
    pruneItemCache(key, key.length + value.length);
    setLocalStorageItem(key, value);
  } catch { /* best-effort */ }
}

/**
 * `localStorage.setItem` that makes room when storage is full: the older half
 * of the cached items goes, and the write is tried once more.
 */
export function setLocalStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    return;
  } catch { /* full, most likely */ }
  try {
    const entries = readItemCache();
    for (const entry of entries.slice(0, Math.ceil(entries.length / 2))) {
      localStorage.removeItem(entry.key);
    }
    localStorage.setItem(key, value);
  } catch { /* best-effort */ }
}

interface ItemCacheEntry { key: string; timestamp: number; chars: number }

/** Drops the oldest items until one more of `incomingChars` fits the budget. */
function pruneItemCache(incomingKey: string, incomingChars: number): void {
  try {
    const entries = readItemCache().filter(entry => entry.key !== incomingKey);
    let count = entries.length + 1;
    let chars = incomingChars;
    for (const entry of entries) chars += entry.chars;

    for (const entry of entries) {
      if (count <= MAX_CACHED_ITEMS && chars <= MAX_ITEM_CACHE_CHARS) break;
      localStorage.removeItem(entry.key);
      count--;
      chars -= entry.chars;
    }
  } catch { /* best-effort */ }
}

/** The cached items, oldest first. Unreadable entries are removed. */
function readItemCache(): ItemCacheEntry[] {
  const entries: ItemCacheEntry[] = [];
  const corruptKeys: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(ITEM_CACHE_KEY_PREFIX)) continue;
    const value = localStorage.getItem(key) ?? '';
    const timestamp = readTimestamp(value);
    if (timestamp === null) corruptKeys.push(key);
    else entries.push({ key, timestamp, chars: key.length + value.length });
  }

  // Removed after the scan, which reads localStorage by index.
  for (const key of corruptKeys) {
    localStorage.removeItem(key);
  }

  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * An entry's write time, read without parsing its thread. The field comes after
 * the item and comments, whose quotes are escaped, so its last match is the one.
 */
function readTimestamp(value: string): number | null {
  const at = value.lastIndexOf(TIMESTAMP_FIELD);
  if (at !== -1) {
    const timestamp = Number.parseInt(value.slice(at + TIMESTAMP_FIELD.length), 10);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  try {
    // A readable entry with no write time counts as the oldest.
    const data = JSON.parse(value) as { timestamp?: number };
    return data.timestamp ?? 0;
  } catch {
    return null;
  }
}

// ============================================================================
// Session State (for instant back navigation)
// Uses sessionStorage - clears when tab closes (desired behavior)
// ============================================================================

export const FEED_SESSION_KEY_PREFIX = 'feed:session:';

interface SessionState {
  scrollY: number;
  storyIds: number[];
  position: number;
  seenIds: Iterable<number>;
  hasMore: boolean;
  phase?: 'firebase' | 'algolia';
}

export function saveListSessionState(feedType: FeedType, state: SessionState): void {
  try {
    const key = `${FEED_SESSION_KEY_PREFIX}${feedType}`;
    const data = {
      scrollY: state.scrollY,
      storyIds: state.storyIds,
      position: state.position,
      seenIds: Array.from(state.seenIds),
      hasMore: state.hasMore,
      phase: state.phase,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch { /* best-effort */ }
}

export function getListSessionState(feedType: FeedType): ListSessionState | null {
  try {
    const key = `${FEED_SESSION_KEY_PREFIX}${feedType}`;
    const cached = sessionStorage.getItem(key);
    
    if (!cached) return null;
    
    const data = JSON.parse(cached) as {
      scrollY?: number; storyIds?: number[]; position?: number;
      seenIds?: number[]; hasMore?: boolean; phase?: string; timestamp: number;
    };
    
    // Session state expires after 30 minutes
    const age = Date.now() - data.timestamp;
    if (age > 30 * 60 * 1000) {
      sessionStorage.removeItem(key);
      return null;
    }
    
    return {
      scrollY: data.scrollY ?? 0,
      storyIds: data.storyIds ?? [],
      position: data.position ?? 0,
      seenIds: new Set(data.seenIds ?? []),
      hasMore: data.hasMore ?? true,
      phase: (data.phase === 'firebase' || data.phase === 'algolia') ? data.phase : undefined,
    };
  } catch {
    return null;
  }
}

export function clearListSessionState(feedType: FeedType): void {
  try {
    sessionStorage.removeItem(`${FEED_SESSION_KEY_PREFIX}${feedType}`);
  } catch { /* best-effort */ }
}

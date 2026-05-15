import type { Item, Comment, FeedType, ListSessionState } from '../types';

/**
 * LocalStorage cache for item details with comments.
 * Uses stale-while-revalidate pattern like feedCache.ts
 */

export const ITEM_CACHE_KEY_PREFIX = 'item:';
const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes - consider data "fresh"
const CACHE_STALE_AGE = 24 * 60 * 60 * 1000; // 24 hours - max age before discarding
const MAX_CACHED_ITEMS = 60; // Limit to prevent localStorage bloat

/**
 * Get cached item with comments
 * @param {string|number} itemId
 * @returns {{ item: Object, comments: Array, timestamp: number, isFresh: boolean, orderedDepth: number } | null}
 */
export function getCachedItem(itemId: number | string): { item: Item; comments: Comment[]; timestamp: number; isFresh: boolean; orderedDepth: number } | null {
  try {
    const key = `${ITEM_CACHE_KEY_PREFIX}${itemId}`;
    const cached = localStorage.getItem(key);
    
    if (!cached) return null;
    
    const { item, comments, timestamp, orderedDepth } = JSON.parse(cached) as {
      item: Item; comments: Comment[]; timestamp: number; orderedDepth?: number;
    };
    const age = Date.now() - timestamp;
    
    // Discard if too old
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

/**
 * Save item with comments to cache
 * @param {string|number} itemId
 * @param {Object} item
 * @param {Array} comments
 * @param {number} [orderedDepth=3] - How deep comments are properly ordered (1 = top-level only during prefetch)
 */
export function setCachedItem(itemId: number | string, item: Item, comments: Comment[], orderedDepth = 3): void {
  try {
    // Clean up old entries first
    pruneItemCache();
    
    const key = `${ITEM_CACHE_KEY_PREFIX}${itemId}`;
    const data = {
      item,
      comments,
      timestamp: Date.now(),
      orderedDepth,
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage might be full - try to make room
    try {
      pruneItemCache(5);
      const key = `${ITEM_CACHE_KEY_PREFIX}${itemId}`;
      localStorage.setItem(key, JSON.stringify({ item, comments, timestamp: Date.now(), orderedDepth }));
    } catch {
      // Still failed, silently give up
    }
  }
}

/**
 * Remove oldest cached items to stay under limit
 * @param {number} [removeCount] - Force remove this many entries
 */
function pruneItemCache(removeCount = 0): void {
  try {
    const itemKeys = [];
    const corruptKeys: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(ITEM_CACHE_KEY_PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(key)!) as { timestamp?: number };
          itemKeys.push({ key, timestamp: data.timestamp ?? 0 });
        } catch {
          // Corrupted entry, collect for removal after the scan
          corruptKeys.push(key);
        }
      }
    }
    
    // Remove corrupted entries in a separate pass to avoid
    // mutating localStorage indices during the scan loop.
    for (const key of corruptKeys) {
      localStorage.removeItem(key);
    }
    
    // Sort by timestamp (oldest first)
    itemKeys.sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove oldest entries if over limit or if forced
    const toRemove = removeCount || Math.max(0, itemKeys.length - MAX_CACHED_ITEMS);
    for (let i = 0; i < toRemove && i < itemKeys.length; i++) {
      localStorage.removeItem(itemKeys[i].key);
    }
  } catch {
    // Silently fail
  }
}

// ============================================================================
// Session State (for instant back navigation)
// Uses sessionStorage - clears when tab closes (desired behavior)
// ============================================================================

export const FEED_SESSION_KEY_PREFIX = 'feed:session:';

/**
 * Save list session state for instant back navigation
 */
interface SessionState {
  scrollY: number;
  storyIds: number[];
  position: number;
  seenIds: Iterable<number>;
  hasMore: boolean;
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
      timestamp: Date.now(),
    };
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Silently fail - sessionStorage might be full
  }
}

/**
 * Get saved list session state
 */
export function getListSessionState(feedType: FeedType): ListSessionState | null {
  try {
    const key = `${FEED_SESSION_KEY_PREFIX}${feedType}`;
    const cached = sessionStorage.getItem(key);
    
    if (!cached) return null;
    
    const data = JSON.parse(cached) as {
      scrollY?: number; storyIds?: number[]; position?: number;
      seenIds?: number[]; hasMore?: boolean; timestamp: number;
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
    };
  } catch {
    return null;
  }
}

/**
 * Clear session state for a feed type
 */
export function clearListSessionState(feedType: FeedType): void {
  try {
    sessionStorage.removeItem(`${FEED_SESSION_KEY_PREFIX}${feedType}`);
  } catch {
    // Silently fail
  }
}

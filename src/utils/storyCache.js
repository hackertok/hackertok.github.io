/**
 * LocalStorage cache for story details with comments.
 * Uses stale-while-revalidate pattern like storiesCache.js
 */

const CACHE_KEY_PREFIX = 'hackertok_story_';
const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes - consider data "fresh"
const CACHE_STALE_AGE = 24 * 60 * 60 * 1000; // 24 hours - max age before discarding
const MAX_CACHED_STORIES = 50; // Limit to prevent localStorage bloat

/**
 * Get cached story with comments
 * @param {string|number} storyId
 * @returns {{ story: Object, comments: Array, timestamp: number, isFresh: boolean, orderedDepth: number } | null}
 */
export function getCachedStory(storyId) {
  try {
    const key = `${CACHE_KEY_PREFIX}${storyId}`;
    const cached = localStorage.getItem(key);
    
    if (!cached) return null;
    
    const { story, comments, timestamp, orderedDepth } = JSON.parse(cached);
    const age = Date.now() - timestamp;
    
    // Discard if too old
    if (age > CACHE_STALE_AGE) {
      localStorage.removeItem(key);
      return null;
    }
    
    return {
      story,
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
 * Save story with comments to cache
 * @param {string|number} storyId
 * @param {Object} story
 * @param {Array} comments
 * @param {number} [orderedDepth=3] - How deep comments are properly ordered (1 = top-level only during prefetch)
 */
export function setCachedStory(storyId, story, comments, orderedDepth = 3) {
  try {
    // Clean up old entries first
    pruneStoryCache();
    
    const key = `${CACHE_KEY_PREFIX}${storyId}`;
    const data = {
      story,
      comments,
      timestamp: Date.now(),
      orderedDepth,
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage might be full - try to make room
    try {
      pruneStoryCache(5);
      const key = `${CACHE_KEY_PREFIX}${storyId}`;
      localStorage.setItem(key, JSON.stringify({ story, comments, timestamp: Date.now(), orderedDepth }));
    } catch {
      // Still failed, silently give up
    }
  }
}

/**
 * Remove oldest cached stories to stay under limit
 * @param {number} [removeCount] - Force remove this many entries
 */
function pruneStoryCache(removeCount = 0) {
  try {
    const storyKeys = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_KEY_PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          storyKeys.push({ key, timestamp: data.timestamp || 0 });
        } catch {
          // Corrupted entry, remove it
          localStorage.removeItem(key);
        }
      }
    }
    
    // Sort by timestamp (oldest first)
    storyKeys.sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove oldest entries if over limit or if forced
    const toRemove = removeCount || Math.max(0, storyKeys.length - MAX_CACHED_STORIES);
    for (let i = 0; i < toRemove && i < storyKeys.length; i++) {
      localStorage.removeItem(storyKeys[i].key);
    }
  } catch {
    // Silently fail
  }
}

// ============================================================================
// Session State (for instant back navigation)
// Uses sessionStorage - clears when tab closes (desired behavior)
// ============================================================================

const SESSION_KEY_PREFIX = 'hackertok_session_';

/**
 * Save list session state for instant back navigation
 * @param {string} storyType - 'top' | 'best' | 'show' | 'ask'
 * @param {Object} state - { scrollY, storyIds, position, seenIds, hasMore }
 */
export function saveListSessionState(storyType, state) {
  try {
    const key = `${SESSION_KEY_PREFIX}${storyType}`;
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
 * @param {string} storyType - 'top' | 'best' | 'show' | 'ask'
 * @returns {{ scrollY: number, storyIds: number[], position: number, seenIds: Set<number>, hasMore: boolean } | null}
 */
export function getListSessionState(storyType) {
  try {
    const key = `${SESSION_KEY_PREFIX}${storyType}`;
    const cached = sessionStorage.getItem(key);
    
    if (!cached) return null;
    
    const data = JSON.parse(cached);
    
    // Session state expires after 30 minutes (for very long sessions)
    const age = Date.now() - data.timestamp;
    if (age > 30 * 60 * 1000) {
      sessionStorage.removeItem(key);
      return null;
    }
    
    return {
      scrollY: data.scrollY || 0,
      storyIds: data.storyIds || [],
      position: data.position || 0,
      seenIds: new Set(data.seenIds || []),
      hasMore: data.hasMore ?? true,
    };
  } catch {
    return null;
  }
}

/**
 * Clear session state for a story type
 * @param {string} storyType - 'top' | 'best' | 'show' | 'ask'
 */
export function clearListSessionState(storyType) {
  try {
    sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${storyType}`);
  } catch {
    // Silently fail
  }
}

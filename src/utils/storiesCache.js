/**
 * LocalStorage cache for stories with stale-while-revalidate pattern.
 * 
 * Strategy:
 * 1. On load, immediately return cached stories (if available)
 * 2. Fetch fresh data in background
 * 3. Update UI when fresh data arrives
 * 4. Cache expires after CACHE_MAX_AGE, but stale data is still shown while revalidating
 */

const CACHE_KEY_PREFIX = 'hackertok_stories_';
const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes - consider data "fresh"
const CACHE_STALE_AGE = 24 * 60 * 60 * 1000; // 24 hours - max age before discarding

/**
 * Get cached stories for a specific type
 * @param {string} type - 'top' | 'best' | 'show' | 'ask'
 * @returns {{ stories: Array, timestamp: number, isStale: boolean } | null}
 */
export function getCachedStories(type) {
  try {
    const key = `${CACHE_KEY_PREFIX}${type}`;
    const cached = localStorage.getItem(key);
    
    if (!cached) return null;
    
    const { stories, timestamp } = JSON.parse(cached);
    const age = Date.now() - timestamp;
    
    // Discard if too old
    if (age > CACHE_STALE_AGE) {
      localStorage.removeItem(key);
      return null;
    }
    
    return {
      stories,
      timestamp,
      isStale: age > CACHE_MAX_AGE,
    };
  } catch {
    // localStorage might be unavailable or corrupted
    return null;
  }
}

/**
 * Save stories to cache
 * @param {string} type - 'top' | 'best' | 'show' | 'ask'
 * @param {Array} stories - Stories to cache
 */
export function setCachedStories(type, stories) {
  try {
    const key = `${CACHE_KEY_PREFIX}${type}`;
    const data = {
      stories,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage might be full or unavailable - silently fail
  }
}

/**
 * Clear cache for a specific type or all types
 * @param {string} [type] - 'top' | 'best' | 'show' | 'ask', or undefined to clear all
 */
export function clearStoriesCache(type) {
  try {
    if (type) {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}${type}`);
    } else {
      // Clear all story caches
      Object.keys(localStorage)
        .filter(key => key.startsWith(CACHE_KEY_PREFIX))
        .forEach(key => localStorage.removeItem(key));
    }
  } catch {
    // Silently fail
  }
}

/**
 * Check if cache is fresh (not stale)
 * @param {string} type - 'top' | 'best' | 'show' | 'ask'
 * @returns {boolean}
 */
export function isCacheFresh(type) {
  const cached = getCachedStories(type);
  return cached !== null && !cached.isStale;
}

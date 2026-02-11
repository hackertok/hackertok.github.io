/**
 * LocalStorage cache for story details with comments.
 * Uses stale-while-revalidate pattern like storiesCache.js
 */

const CACHE_KEY_PREFIX = 'hackertok_story_';
const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes - consider data "fresh"
const CACHE_STALE_AGE = 24 * 60 * 60 * 1000; // 24 hours - max age before discarding
const MAX_CACHED_STORIES = 20; // Limit to prevent localStorage bloat

/**
 * Get cached story with comments
 * @param {string|number} storyId
 * @returns {{ story: Object, comments: Array, timestamp: number, isFresh: boolean } | null}
 */
export function getCachedStory(storyId) {
  try {
    const key = `${CACHE_KEY_PREFIX}${storyId}`;
    const cached = localStorage.getItem(key);
    
    if (!cached) return null;
    
    const { story, comments, timestamp } = JSON.parse(cached);
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
 */
export function setCachedStory(storyId, story, comments) {
  try {
    // Clean up old entries first
    pruneStoryCache();
    
    const key = `${CACHE_KEY_PREFIX}${storyId}`;
    const data = {
      story,
      comments,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage might be full - try to make room
    try {
      pruneStoryCache(5);
      const key = `${CACHE_KEY_PREFIX}${storyId}`;
      localStorage.setItem(key, JSON.stringify({ story, comments, timestamp: Date.now() }));
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

/**
 * Clear cached story
 * @param {string|number} storyId
 */
export function clearCachedStory(storyId) {
  try {
    localStorage.removeItem(`${CACHE_KEY_PREFIX}${storyId}`);
  } catch {
    // Silently fail
  }
}

/**
 * Track viewed stories in localStorage.
 * Simple append-only storage - story IDs are small (~8 bytes each).
 */

const STORAGE_KEY = 'hackertok_viewed';

// Cache the Set in memory for O(1) lookups during render
let viewedSet = null;

/**
 * Load viewed stories from localStorage into memory cache.
 */
function loadViewedSet() {
  if (viewedSet !== null) return viewedSet;
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    viewedSet = stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    viewedSet = new Set();
  }
  return viewedSet;
}

/**
 * Check if a story has been viewed.
 * @param {number|string} storyId
 * @returns {boolean}
 */
export function isViewed(storyId) {
  return loadViewedSet().has(Number(storyId));
}

/**
 * Mark a story as viewed.
 * @param {number|string} storyId
 */
export function markViewed(storyId) {
  const set = loadViewedSet();
  const id = Number(storyId);
  
  if (set.has(id)) return; // Already viewed
  
  set.add(id);
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage full - silently fail
  }
}

/**
 * Clear all viewed stories (for testing/debugging).
 */
export function clearViewed() {
  viewedSet = new Set();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail
  }
}

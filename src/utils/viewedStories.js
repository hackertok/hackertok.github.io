import { useSyncExternalStore } from 'react';

/**
 * Track viewed stories in localStorage.
 * Simple append-only storage - story IDs are small (~8 bytes each).
 */

const STORAGE_KEY = 'hackertok_viewed';
const STORAGE_KEY_TIMES = 'hackertok_viewed_times';
const SESSION_KEY = 'hackertok_session_viewed';
const MAX_VIEWED_IDS = 50_000;

// Cache the Set in memory for O(1) lookups during render
let viewedSet = null;
// Cache for time-based viewed stories { id: timestamp }
let viewedTimesCache = null;
// Cache for session-viewed stories (current session only)
let sessionViewedCache = null;

// Listener set for useSyncExternalStore subscriptions
const listeners = new Set();

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners() {
  listeners.forEach(cb => cb());
}

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
  
  // Evict oldest entries if over limit (Set iterates in insertion order)
  while (set.size > MAX_VIEWED_IDS) {
    set.delete(set.values().next().value);
  }
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage full - silently fail
  }
  notifyListeners();
}

/**
 * Clear all viewed stories (for testing/debugging).
 */
export function clearViewed() {
  viewedSet = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail
  }
  notifyListeners();
}

/**
 * React hook — reactively returns whether a story has been viewed.
 * All components using this hook re-render when any story's viewed state changes.
 * @param {number|string} storyId
 * @returns {boolean}
 */
export function useIsViewed(storyId) {
  return useSyncExternalStore(subscribe, () => isViewed(storyId));
}

// ============================================================================
// Time-based viewed tracking (for 24-hour filtering in swipe mode)
// ============================================================================

/**
 * Load viewed times from localStorage into memory cache.
 * @returns {Object} Map of { storyId: timestamp }
 */
function loadViewedTimes() {
  if (viewedTimesCache !== null) return viewedTimesCache;
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY_TIMES);
    viewedTimesCache = stored ? JSON.parse(stored) : {};
  } catch {
    viewedTimesCache = {};
  }
  return viewedTimesCache;
}

/**
 * Save viewed times to localStorage.
 */
function saveViewedTimes() {
  try {
    localStorage.setItem(STORAGE_KEY_TIMES, JSON.stringify(viewedTimesCache));
  } catch {
    // localStorage full - silently fail
  }
}

/**
 * Get IDs of stories viewed within the specified time window.
 * @param {number} hours - Time window in hours (default 24)
 * @returns {Set<number>} Set of story IDs viewed within the window
 */
export function getRecentlyViewedIds(hours = 24) {
  const times = loadViewedTimes();
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  const recentIds = new Set();
  
  for (const [id, timestamp] of Object.entries(times)) {
    if (timestamp >= cutoff) {
      recentIds.add(Number(id));
    }
  }
  
  return recentIds;
}

/**
 * Mark a story as viewed with timestamp.
 * Also calls markViewed() for permanent visual styling.
 * Also adds to session storage so it won't be filtered this session.
 * @param {number|string} storyId
 */
export function markViewedWithTime(storyId) {
  const id = Number(storyId);
  
  // Also mark in permanent store for visual styling
  markViewed(id);
  
  // Add to session storage (won't be filtered this session)
  addToSessionViewed(id);
  
  const times = loadViewedTimes();
  times[id] = Date.now();
  saveViewedTimes();
}

/**
 * Remove viewed entries older than the specified time window.
 * Call on app startup to keep storage bounded.
 * @param {number} hours - Time window in hours (default 24)
 */
export function pruneExpiredViewed(hours = 24) {
  const times = loadViewedTimes();
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  let pruned = false;
  
  for (const [id, timestamp] of Object.entries(times)) {
    if (timestamp < cutoff) {
      delete times[id];
      pruned = true;
    }
  }
  
  if (pruned) {
    saveViewedTimes();
  }
}

/**
 * Clear all time-based viewed stories (for testing).
 */
export function clearViewedTimes() {
  viewedTimesCache = {};
  try {
    localStorage.removeItem(STORAGE_KEY_TIMES);
  } catch {
    // Silently fail
  }
}

// ============================================================================
// Session-scoped viewed tracking (stories viewed in current browser session)
// Uses sessionStorage - clears when tab/browser closes
// ============================================================================

/**
 * Load session-viewed IDs from sessionStorage into memory cache.
 * @returns {Set<number>} Set of story IDs viewed this session
 */
function loadSessionViewed() {
  if (sessionViewedCache !== null) return sessionViewedCache;
  
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    sessionViewedCache = stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    sessionViewedCache = new Set();
  }
  return sessionViewedCache;
}

/**
 * Save session-viewed IDs to sessionStorage.
 */
function saveSessionViewed() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...sessionViewedCache]));
  } catch {
    // sessionStorage full - silently fail
  }
}

/**
 * Get IDs of stories viewed in this session.
 * @returns {Set<number>} Set of story IDs viewed this session
 */
export function getSessionViewedIds() {
  return new Set(loadSessionViewed());
}

/**
 * Add a story ID to session-viewed list.
 * @param {number|string} storyId
 */
export function addToSessionViewed(storyId) {
  const set = loadSessionViewed();
  const id = Number(storyId);
  
  if (set.has(id)) return;
  
  set.add(id);
  saveSessionViewed();
}

/**
 * Clear all session-viewed stories (for testing).
 */
export function clearSessionViewed() {
  sessionViewedCache = new Set();
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Silently fail
  }
}

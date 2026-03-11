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
let viewedSet: Set<number> | null = null;
// Cache for time-based viewed stories { id: timestamp }
let viewedTimesCache: Record<string, number> | null = null;
// Cache for session-viewed stories (current session only)
let sessionViewedCache: Set<number> | null = null;

// Listener set for useSyncExternalStore subscriptions
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners() {
  listeners.forEach(cb => cb());
}

/**
 * Load viewed stories from localStorage into memory cache.
 */
function loadViewedSet(): Set<number> {
  if (viewedSet !== null) return viewedSet;
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    viewedSet = stored ? new Set(JSON.parse(stored) as number[]) : new Set();
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
export function isViewed(storyId: number | string): boolean {
  return loadViewedSet().has(Number(storyId));
}

/**
 * Mark a story as viewed.
 * @param {number|string} storyId
 */
export function markViewed(storyId: number | string): void {
  const set = loadViewedSet();
  const id = Number(storyId);
  
  if (set.has(id)) return; // Already viewed
  
  set.add(id);
  
  // Evict oldest entries if over limit (Set iterates in insertion order)
  while (set.size > MAX_VIEWED_IDS) {
    const first = set.values().next().value;
    if (first !== undefined) set.delete(first);
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
export function useIsViewed(storyId: number | string): boolean {
  return useSyncExternalStore(subscribe, () => isViewed(storyId));
}

// ============================================================================
// Time-based viewed tracking (for 24-hour filtering in swipe mode)
// ============================================================================

/**
 * Load viewed times from localStorage into memory cache.
 * @returns {Object} Map of { storyId: timestamp }
 */
function loadViewedTimes(): Record<string, number> {
  if (viewedTimesCache !== null) return viewedTimesCache;
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY_TIMES);
    viewedTimesCache = stored ? JSON.parse(stored) as Record<string, number> : {};
  } catch {
    viewedTimesCache = {};
  }
  return viewedTimesCache;
}

/**
 * Save viewed times to localStorage.
 */
function saveViewedTimes(): void {
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
export function getRecentlyViewedIds(hours = 24): Set<number> {
  const times = loadViewedTimes();
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  const recentIds = new Set<number>();
  
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
export function markViewedWithTime(storyId: number | string): void {
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
export function pruneExpiredViewed(hours = 24): void {
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
function loadSessionViewed(): Set<number> {
  if (sessionViewedCache !== null) return sessionViewedCache;
  
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    sessionViewedCache = stored ? new Set(JSON.parse(stored) as number[]) : new Set();
  } catch {
    sessionViewedCache = new Set();
  }
  return sessionViewedCache;
}

/**
 * Save session-viewed IDs to sessionStorage.
 */
function saveSessionViewed(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...sessionViewedCache!]));
  } catch {
    // sessionStorage full - silently fail
  }
}

/**
 * Get IDs of stories viewed in this session.
 * @returns {Set<number>} Set of story IDs viewed this session
 */
export function getSessionViewedIds(): Set<number> {
  return new Set(loadSessionViewed());
}

/**
 * Add a story ID to session-viewed list.
 * @param {number|string} storyId
 */
export function addToSessionViewed(storyId: number | string): void {
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

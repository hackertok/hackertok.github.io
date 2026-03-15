import { useSyncExternalStore } from 'react';

/**
 * Track viewed items in localStorage.
 * Simple append-only storage - item IDs are small (~8 bytes each).
 */

export const VIEWED_KEY = 'viewed';
export const VIEWED_TIMES_KEY = 'viewed:times';
export const VIEWED_SESSION_KEY = 'viewed:session';
const MAX_VIEWED_IDS = 50_000;

// Cache the Set in memory for O(1) lookups during render
let viewedSet: Set<number> | null = null;
// Cache for time-based viewed items { id: timestamp }
let viewedTimesCache: Record<string, number> | null = null;
// Cache for session-viewed items (current session only)
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
 * Load viewed items from localStorage into memory cache.
 */
function loadViewedSet(): Set<number> {
  if (viewedSet !== null) return viewedSet;
  
  try {
    const stored = localStorage.getItem(VIEWED_KEY);
    viewedSet = stored ? new Set(JSON.parse(stored) as number[]) : new Set();
  } catch {
    viewedSet = new Set();
  }
  return viewedSet;
}

/**
 * Check if an item has been viewed.
 * @param {number|string} itemId
 * @returns {boolean}
 */
export function isViewed(itemId: number | string): boolean {
  return loadViewedSet().has(Number(itemId));
}

/**
 * Mark an item as viewed.
 * @param {number|string} itemId
 */
export function markViewed(itemId: number | string): void {
  const set = loadViewedSet();
  const id = Number(itemId);
  
  if (set.has(id)) return; // Already viewed
  
  set.add(id);
  
  // Evict oldest entries if over limit (Set iterates in insertion order)
  while (set.size > MAX_VIEWED_IDS) {
    const first = set.values().next().value;
    if (first !== undefined) set.delete(first);
  }
  
  try {
    localStorage.setItem(VIEWED_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage full - silently fail
  }
  notifyListeners();
}

/**
 * Clear all viewed items (for testing/debugging).
 */
export function clearViewed() {
  viewedSet = null;
  try {
    localStorage.removeItem(VIEWED_KEY);
  } catch {
    // Silently fail
  }
  notifyListeners();
}

/**
 * React hook — reactively returns whether an item has been viewed.
 * All components using this hook re-render when any item's viewed state changes.
 * @param {number|string} itemId
 * @returns {boolean}
 */
export function useIsViewed(itemId: number | string): boolean {
  return useSyncExternalStore(subscribe, () => isViewed(itemId));
}

// ============================================================================
// Time-based viewed tracking (for 24-hour filtering in swipe mode)
// ============================================================================

/**
 * Load viewed times from localStorage into memory cache.
 * @returns {Object} Map of { itemId: timestamp }
 */
function loadViewedTimes(): Record<string, number> {
  if (viewedTimesCache !== null) return viewedTimesCache;
  
  try {
    const stored = localStorage.getItem(VIEWED_TIMES_KEY);
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
    localStorage.setItem(VIEWED_TIMES_KEY, JSON.stringify(viewedTimesCache));
  } catch {
    // localStorage full - silently fail
  }
}

/**
 * Get IDs of items viewed within the specified time window.
 * @param {number} hours - Time window in hours (default 24)
 * @returns {Set<number>} Set of item IDs viewed within the window
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
 * Mark an item as viewed with timestamp.
 * Also calls markViewed() for permanent visual styling.
 * Also adds to session storage so it won't be filtered this session.
 * @param {number|string} itemId
 */
export function markViewedWithTime(itemId: number | string): void {
  const id = Number(itemId);
  
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
 * Clear all time-based viewed items (for testing).
 */
export function clearViewedTimes() {
  viewedTimesCache = {};
  try {
    localStorage.removeItem(VIEWED_TIMES_KEY);
  } catch {
    // Silently fail
  }
}

// ============================================================================
// Session-scoped viewed tracking (items viewed in current browser session)
// Uses sessionStorage - clears when tab/browser closes
// ============================================================================

/**
 * Load session-viewed IDs from sessionStorage into memory cache.
 * @returns {Set<number>} Set of item IDs viewed this session
 */
function loadSessionViewed(): Set<number> {
  if (sessionViewedCache !== null) return sessionViewedCache;
  
  try {
    const stored = sessionStorage.getItem(VIEWED_SESSION_KEY);
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
    sessionStorage.setItem(VIEWED_SESSION_KEY, JSON.stringify([...sessionViewedCache!]));
  } catch {
    // sessionStorage full - silently fail
  }
}

/**
 * Get IDs of items viewed in this session.
 * @returns {Set<number>} Set of item IDs viewed this session
 */
export function getSessionViewedIds(): Set<number> {
  return new Set(loadSessionViewed());
}

/**
 * Add an item ID to session-viewed list.
 * @param {number|string} itemId
 */
export function addToSessionViewed(itemId: number | string): void {
  const set = loadSessionViewed();
  const id = Number(itemId);
  
  if (set.has(id)) return;
  
  set.add(id);
  saveSessionViewed();
}

/**
 * Clear all session-viewed items (for testing).
 */
export function clearSessionViewed() {
  sessionViewedCache = new Set();
  try {
    sessionStorage.removeItem(VIEWED_SESSION_KEY);
  } catch {
    // Silently fail
  }
}

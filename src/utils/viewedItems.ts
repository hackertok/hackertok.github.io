import { useSyncExternalStore } from 'react';

/**
 * Track viewed items in localStorage. Simple append-only storage — item IDs
 * are small (~8 bytes each).
 */

export const VIEWED_KEY = 'viewed';
export const VIEWED_TIMES_KEY = 'viewed:times';
export const VIEWED_SESSION_KEY = 'viewed:session';
const MAX_VIEWED_IDS = 50_000;

// O(1) in-memory caches; rebuilt lazily from storage on first access.
let viewedSet: Set<number> | null = null;
let viewedTimesCache: Record<string, number> | null = null;
let sessionViewedCache: Set<number> | null = null;

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners() {
  listeners.forEach(cb => cb());
}

// ============================================================================
// Permanent viewed tracking (persists across sessions in localStorage)
// ============================================================================

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

/** True iff the item has been viewed (in any prior session). */
export function isViewed(itemId: number | string): boolean {
  return loadViewedSet().has(Number(itemId));
}

export function markViewed(itemId: number | string): void {
  const set = loadViewedSet();
  const id = Number(itemId);
  
  if (set.has(id)) return;
  
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

/** Clear all viewed items (for testing/debugging). */
export function clearViewed() {
  viewedSet = null;
  try {
    localStorage.removeItem(VIEWED_KEY);
  } catch { /* localStorage unavailable - silently fail */ }
  notifyListeners();
}

/**
 * Reactive variant of {@link isViewed}. Re-renders subscribers whenever any
 * item's viewed state changes.
 */
export function useIsViewed(itemId: number | string): boolean {
  return useSyncExternalStore(subscribe, () => isViewed(itemId));
}

// ============================================================================
// Time-based viewed tracking (for 24-hour filtering in swipe mode)
// ============================================================================

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

function saveViewedTimes(): void {
  try {
    localStorage.setItem(VIEWED_TIMES_KEY, JSON.stringify(viewedTimesCache));
  } catch {
    // localStorage full - silently fail
  }
}

/** IDs of items viewed within the last `hours` hours. */
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
 * Mark with timestamp + persist to permanent store (for styling) + add to
 * session-viewed (so it won't be filtered out for the rest of the session).
 */
export function markViewedWithTime(itemId: number | string): void {
  const id = Number(itemId);
  
  markViewed(id);
  addToSessionViewed(id);
  
  const times = loadViewedTimes();
  times[id] = Date.now();
  saveViewedTimes();
}

/** Drop entries older than `hours`. Call on app startup to keep storage bounded. */
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

/** Clear all time-based viewed items (for testing). */
export function clearViewedTimes() {
  viewedTimesCache = {};
  try {
    localStorage.removeItem(VIEWED_TIMES_KEY);
  } catch { /* localStorage unavailable - silently fail */ }
}

// ============================================================================
// Session-scoped viewed tracking (items viewed in current browser session)
// Uses sessionStorage - clears when tab/browser closes
// ============================================================================

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

function saveSessionViewed(): void {
  try {
    sessionStorage.setItem(VIEWED_SESSION_KEY, JSON.stringify([...sessionViewedCache!]));
  } catch {
    // sessionStorage full - silently fail
  }
}

export function getSessionViewedIds(): Set<number> {
  return new Set(loadSessionViewed());
}

export function addToSessionViewed(itemId: number | string): void {
  const set = loadSessionViewed();
  const id = Number(itemId);
  
  if (set.has(id)) return;
  
  set.add(id);
  saveSessionViewed();
}

/** Clear all session-viewed items (for testing). */
export function clearSessionViewed() {
  sessionViewedCache = new Set();
  try {
    sessionStorage.removeItem(VIEWED_SESSION_KEY);
  } catch { /* sessionStorage unavailable - silently fail */ }
}

import { useSyncExternalStore } from 'react';

/** Track viewed items in localStorage. */

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
  } catch { /* best-effort */ }
  notifyListeners();
}

export function clearViewed() {
  viewedSet = null;
  try {
    localStorage.removeItem(VIEWED_KEY);
  } catch { /* best-effort */ }
  notifyListeners();
}

/** Reactive `isViewed` — re-renders on change. */
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
  } catch { /* best-effort */ }
}

export function getRecentlyViewedIds(hours = 24): Set<number> {
  const times = loadViewedTimes();
  const cutoff = Date.now() - (hours * 60 * 60 * 1000); // hours → ms
  const recentIds = new Set<number>();
  
  for (const [id, timestamp] of Object.entries(times)) {
    if (timestamp >= cutoff) {
      recentIds.add(Number(id));
    }
  }
  
  return recentIds;
}

/** Mark viewed with timestamp; persists to permanent + session stores. */
export function markViewedWithTime(itemId: number | string): void {
  const id = Number(itemId);
  
  markViewed(id);
  addToSessionViewed(id);
  
  const times = loadViewedTimes();
  times[id] = Date.now();
  saveViewedTimes();
}

export function pruneExpiredViewed(hours = 24): void {
  const times = loadViewedTimes();
  const cutoff = Date.now() - (hours * 60 * 60 * 1000); // hours → ms
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

export function clearViewedTimes() {
  viewedTimesCache = {};
  try {
    localStorage.removeItem(VIEWED_TIMES_KEY);
  } catch { /* best-effort */ }
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
  } catch { /* best-effort */ }
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

export function clearSessionViewed() {
  sessionViewedCache = new Set();
  try {
    sessionStorage.removeItem(VIEWED_SESSION_KEY);
  } catch { /* best-effort */ }
}

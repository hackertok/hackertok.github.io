import { useSyncExternalStore } from 'react';

/** Track viewed items in localStorage. */

export const VIEWED_KEY = 'viewed';
export const VIEWED_SESSION_KEY = 'viewed:session';
const MAX_VIEWED_IDS = 50_000;

// O(1) in-memory caches; rebuilt lazily from storage on first access.
let viewedSet: Set<number> | null = null;
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
// Time-based viewed tracking (differentiated TTLs for swipe-mode filtering)
// ============================================================================

export const VIEWED_TITLE_TIMES_KEY = 'viewed:times:title';
export const VIEWED_DETAIL_TIMES_KEY = 'viewed:times:detail';
export const TITLE_CLICK_TTL_HOURS = 120; // 5 days
export const DETAIL_VIEW_TTL_HOURS = 12;

let titleTimesCache: Record<string, number> | null = null;
let detailTimesCache: Record<string, number> | null = null;

function loadTitleTimes(): Record<string, number> {
  if (titleTimesCache !== null) return titleTimesCache;
  try {
    const stored = localStorage.getItem(VIEWED_TITLE_TIMES_KEY);
    titleTimesCache = stored ? JSON.parse(stored) as Record<string, number> : {};
  } catch {
    titleTimesCache = {};
  }
  return titleTimesCache;
}

function saveTitleTimes(): void {
  try {
    localStorage.setItem(VIEWED_TITLE_TIMES_KEY, JSON.stringify(titleTimesCache));
  } catch { /* best-effort */ }
}

function loadDetailTimes(): Record<string, number> {
  if (detailTimesCache !== null) return detailTimesCache;
  try {
    const stored = localStorage.getItem(VIEWED_DETAIL_TIMES_KEY);
    detailTimesCache = stored ? JSON.parse(stored) as Record<string, number> : {};
  } catch {
    detailTimesCache = {};
  }
  return detailTimesCache;
}

function saveDetailTimes(): void {
  try {
    localStorage.setItem(VIEWED_DETAIL_TIMES_KEY, JSON.stringify(detailTimesCache));
  } catch { /* best-effort */ }
}

/** Get IDs that should be filtered (hidden) in swipe mode, using per-kind TTLs. */
export function getFilteredViewedIds(): Set<number> {
  const now = Date.now();
  const result = new Set<number>();

  const titleTimes = loadTitleTimes();
  const titleCutoff = now - TITLE_CLICK_TTL_HOURS * 3_600_000;
  for (const [id, timestamp] of Object.entries(titleTimes)) {
    if (timestamp >= titleCutoff) {
      result.add(Number(id));
    }
  }

  const detailTimes = loadDetailTimes();
  const detailCutoff = now - DETAIL_VIEW_TTL_HOURS * 3_600_000;
  for (const [id, timestamp] of Object.entries(detailTimes)) {
    if (timestamp >= detailCutoff) {
      result.add(Number(id));
    }
  }

  return result;
}

/** Mark viewed with timestamp; persists to permanent + session stores. */
export function markViewedWithTime(itemId: number | string, kind: 'title' | 'detail' = 'detail'): void {
  const id = Number(itemId);

  if (kind === 'title') markViewed(id);
  addToSessionViewed(id);

  if (kind === 'title') {
    const times = loadTitleTimes();
    times[id] = Date.now();
    saveTitleTimes();
  } else {
    const times = loadDetailTimes();
    times[id] = Date.now();
    saveDetailTimes();
  }
}

export function pruneExpiredViewed(): void {
  const now = Date.now();

  const titleTimes = loadTitleTimes();
  const titleCutoff = now - TITLE_CLICK_TTL_HOURS * 3_600_000;
  let pruned = false;
  for (const [id, timestamp] of Object.entries(titleTimes)) {
    if (timestamp < titleCutoff) {
      delete titleTimes[id];
      pruned = true;
    }
  }
  if (pruned) saveTitleTimes();

  const detailTimes = loadDetailTimes();
  const detailCutoff = now - DETAIL_VIEW_TTL_HOURS * 3_600_000;
  pruned = false;
  for (const [id, timestamp] of Object.entries(detailTimes)) {
    if (timestamp < detailCutoff) {
      delete detailTimes[id];
      pruned = true;
    }
  }
  if (pruned) saveDetailTimes();
}

export function clearViewedTimes() {
  titleTimesCache = null;
  detailTimesCache = null;
  try {
    localStorage.removeItem(VIEWED_TITLE_TIMES_KEY);
    localStorage.removeItem(VIEWED_DETAIL_TIMES_KEY);
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

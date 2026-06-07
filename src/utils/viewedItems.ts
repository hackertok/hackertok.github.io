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
// Time-based viewed tracking (swipe-mode filtering)
//
// Each map stores `id -> expiresAt` (absolute ms). An item is hidden from the
// swipe feed while `expiresAt > now`. Title clicks use a fixed 5-day window;
// detail views use a dwell-based window (the longer you look, the longer it
// stays hidden). Storing the expiry — rather than the view time + a fixed TTL —
// lets each entry carry its own variable lifetime.
// ============================================================================

export const VIEWED_TITLE_TIMES_KEY = 'viewed:times:title';
export const VIEWED_DETAIL_TIMES_KEY = 'viewed:times:detail';
export const TITLE_CLICK_TTL_HOURS = 120;        // 5 days
export const DETAIL_VIEW_TTL_HOURS = 12;         // dwell < 3s (short / floor)
export const DETAIL_VIEW_TTL_MEDIUM_HOURS = 24;  // dwell 3-60s
export const DETAIL_VIEW_TTL_LONG_HOURS = 48;    // dwell >= 60s (2 days)
export const DETAIL_DWELL_MEDIUM_MS = 3_000;
export const DETAIL_DWELL_LONG_MS = 60_000;

/** Map detail-view dwell time to a hide TTL (hours): longer engagement hides longer. */
export function detailTtlHoursForDwell(dwellMs: number): number {
  if (dwellMs >= DETAIL_DWELL_LONG_MS) return DETAIL_VIEW_TTL_LONG_HOURS;
  if (dwellMs >= DETAIL_DWELL_MEDIUM_MS) return DETAIL_VIEW_TTL_MEDIUM_HOURS;
  return DETAIL_VIEW_TTL_HOURS;
}

// Each kind (title / detail) is an `id -> expiresAt` map backed by localStorage
// with a lazily-built in-memory cache. The factory is the single source of truth
// for that load/cache/save/reset behavior; `titleTimeMap`/`detailTimeMap` are its
// two instances.
function createTimeMap(storageKey: string) {
  let cache: Record<string, number> | null = null;
  return {
    load(): Record<string, number> {
      if (cache !== null) return cache;
      try {
        const stored = localStorage.getItem(storageKey);
        // Tolerate a corrupt/foreign value at our key. Only a plain object is a
        // valid id->expiresAt map, and only finite-number values are valid
        // expiries — drop anything else so the rest of the code can assume
        // `times[id]` is always a number. (A non-number would poison the
        // Math.max merge with NaN, which `===` can never settle, permanently
        // wedging that id: never hidden, re-written on every view.)
        const parsed: unknown = stored ? JSON.parse(stored) : null;
        const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
        const clean: Record<string, number> = {};
        for (const [id, expiresAt] of Object.entries(raw)) {
          if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
            clean[id] = expiresAt;
          }
        }
        cache = clean;
      } catch {
        cache = {};
      }
      return cache;
    },
    save(): void {
      try {
        localStorage.setItem(storageKey, JSON.stringify(cache));
      } catch { /* best-effort */ }
    },
    reset(): void {
      cache = null;
    },
  };
}

const titleTimeMap = createTimeMap(VIEWED_TITLE_TIMES_KEY);
const detailTimeMap = createTimeMap(VIEWED_DETAIL_TIMES_KEY);

/** Get IDs that should be filtered (hidden) in swipe mode — entries not yet expired. */
export function getFilteredViewedIds(): Set<number> {
  const now = Date.now();
  const result = new Set<number>();

  for (const map of [titleTimeMap.load(), detailTimeMap.load()]) {
    for (const [id, expiresAt] of Object.entries(map)) {
      if (expiresAt > now) result.add(Number(id));
    }
  }

  return result;
}

/**
 * Mark viewed with an expiry; persists to the time-based + session stores (and,
 * for title clicks, the permanent store that drives visual dimming).
 *
 * `ttlHours` controls how long the item stays hidden in swipe mode. The stored
 * expiry is merged with `Math.max`, so re-viewing only ever extends the hide
 * window — a later or shorter view never shortens an existing one.
 */
export function markViewedWithTime(
  itemId: number | string,
  kind: 'title' | 'detail' = 'detail',
  ttlHours = kind === 'title' ? TITLE_CLICK_TTL_HOURS : DETAIL_VIEW_TTL_HOURS,
): void {
  const id = Number(itemId);

  if (kind === 'title') markViewed(id);
  addToSessionViewed(id);

  const map = kind === 'title' ? titleTimeMap : detailTimeMap;
  const nextExpiry = Date.now() + ttlHours * 3_600_000;
  const times = map.load();
  const merged = Math.max(times[id] ?? 0, nextExpiry);
  // Skip the stringify + write when the merge changes nothing — e.g. re-viewing
  // an item whose hide window is already longer, or an idempotent re-finalize.
  if (merged === times[id]) return;
  times[id] = merged;
  map.save();
}

export function pruneExpiredViewed(): void {
  const now = Date.now();

  for (const map of [titleTimeMap, detailTimeMap]) {
    const times = map.load();
    let pruned = false;
    for (const [id, expiresAt] of Object.entries(times)) {
      if (expiresAt <= now) {
        delete times[id];
        pruned = true;
      }
    }
    if (pruned) map.save();
  }
}

export function clearViewedTimes() {
  titleTimeMap.reset();
  detailTimeMap.reset();
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

import type { StoryItem, FeedType } from '../types';

/** Feed list cache (localStorage, stale-while-revalidate). */

export const FEED_CACHE_KEY_PREFIX = 'feed:';
const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes
const CACHE_STALE_AGE = 24 * 60 * 60 * 1000; // 24 hours

export function getCachedFeed(type: FeedType): { stories: StoryItem[]; timestamp: number; isStale: boolean } | null {
  try {
    const key = `${FEED_CACHE_KEY_PREFIX}${type}`;
    const cached = localStorage.getItem(key);
    
    if (!cached) return null;
    
    const { stories, timestamp } = JSON.parse(cached) as { stories: StoryItem[]; timestamp: number };
    const age = Date.now() - timestamp;
    
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
    return null;
  }
}

export function setCachedFeed(type: FeedType, stories: StoryItem[]): void {
  try {
    const key = `${FEED_CACHE_KEY_PREFIX}${type}`;
    const data = { stories, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(data));
  } catch { /* best-effort */ }
}

export function clearFeedCache(type?: FeedType): void {
  try {
    if (type) {
      localStorage.removeItem(`${FEED_CACHE_KEY_PREFIX}${type}`);
    } else {
      Object.keys(localStorage)
        .filter(key => key.startsWith(FEED_CACHE_KEY_PREFIX))
        .forEach(key => localStorage.removeItem(key));
    }
  } catch { /* best-effort */ }
}

export function isCacheFresh(type: FeedType): boolean {
  const cached = getCachedFeed(type);
  return cached !== null && !cached.isStale;
}

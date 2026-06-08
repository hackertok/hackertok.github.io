import type { StoryItem, SwipePosition } from '../types';

/**
 * Durable per-tab swipe-position snapshot (sessionStorage). Survives a full reload
 * (bfcache miss) so the viewer can re-find the user's story + neighbors instead of
 * collapsing to index 0. One key — we only need "the position you just left."
 */

export const SWIPE_POSITION_KEY = '__swipe_pos';

// Matches the existing list session-state window (getListSessionState).
const SWIPE_POSITION_TTL_MS = 30 * 60 * 1000;

// How many stories to keep AHEAD of the anchor. Behind it we store the whole
// scrollback (from index 0), so a restore rebuilds the list in feed order —
// prepending it can't push live front-stories behind the anchor. Ahead, a small
// look-ahead suffices; loadMore refills as the user swipes forward.
export const SWIPE_POSITION_AHEAD = 10;

/** Lean projection: omits `text` (the heavy Ask/Show HTML body); FullScreenItem re-fetches. */
function projectStory(s: StoryItem): StoryItem {
  return {
    id: s.id,
    type: s.type,
    title: s.title,
    url: s.url,
    points: s.points,
    author: s.author,
    createdAt: s.createdAt,
    commentCount: s.commentCount,
  };
}

/**
 * Persist the current position: stores the scrollback from the front (index 0)
 * through a small look-ahead past `index`, so `stories[index].id === storyId` holds
 * and a reload rebuilds the list in feed order. Best-effort (quota / serialization
 * failures are swallowed).
 */
export function saveSwipePosition(record: Omit<SwipePosition, 'savedAt'>): void {
  try {
    const { stories, index } = record;
    const end = Math.min(stories.length, index + SWIPE_POSITION_AHEAD + 1);
    const windowed = stories.slice(0, end).map(projectStory);

    const payload: SwipePosition = {
      viewer: record.viewer,
      storyId: record.storyId,
      index,
      scrollY: record.scrollY,
      stories: windowed,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(SWIPE_POSITION_KEY, JSON.stringify(payload));
  } catch {
    /* quota / serialization — non-critical */
  }
}

/** Read the snapshot, or null if absent/corrupt/expired (expired entries are removed). */
export function readSwipePosition(): SwipePosition | null {
  try {
    const raw = sessionStorage.getItem(SWIPE_POSITION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SwipePosition>;
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      typeof parsed.storyId !== 'number' ||
      !parsed.viewer ||
      typeof parsed.viewer !== 'object' ||
      !Array.isArray(parsed.stories)
    ) {
      return null;
    }

    if (Date.now() - parsed.savedAt > SWIPE_POSITION_TTL_MS) {
      sessionStorage.removeItem(SWIPE_POSITION_KEY);
      return null;
    }

    return {
      viewer: parsed.viewer,
      storyId: parsed.storyId,
      index: typeof parsed.index === 'number' ? parsed.index : 0,
      scrollY: typeof parsed.scrollY === 'number' ? parsed.scrollY : 0,
      stories: parsed.stories,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearSwipePosition(): void {
  try {
    sessionStorage.removeItem(SWIPE_POSITION_KEY);
  } catch {
    /* best-effort */
  }
}

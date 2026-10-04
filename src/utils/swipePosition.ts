import type { LocationState, StoryItem, SwipePosition } from '../types';

/**
 * Durable per-tab swipe-position snapshots (sessionStorage). Survive a full reload
 * (bfcache miss) so the viewer can re-find the user's story + neighbors instead of
 * collapsing to index 0. One record per viewer (feed, domain, or user), newest
 * first, so leaving one feed for another doesn't replace the first feed's position.
 */

export const SWIPE_POSITION_KEY = '__swipe_pos';

// Matches the existing list session-state window (getListSessionState).
const SWIPE_POSITION_TTL_MS = 30 * 60 * 1000;

// How many stories to keep AHEAD of the anchor. Behind it we store the whole
// scrollback (from index 0), so a restore rebuilds the list in feed order —
// prepending it can't push live front-stories behind the anchor. Ahead, a small
// look-ahead suffices; loadMore refills as the user swipes forward.
export const SWIPE_POSITION_AHEAD = 10;

// Bounds storage when many domains/users get visited in one session.
export const SWIPE_POSITION_MAX_VIEWERS = 8;

/** Two LocationStates refer to the same viewer when they share a feed/domain/user. */
export function sameViewer(a: LocationState, b: LocationState): boolean {
  return (
    (a.from ?? null) === (b.from ?? null) &&
    (a.fromDomain ?? null) === (b.fromDomain ?? null) &&
    (a.fromUser ?? null) === (b.fromUser ?? null)
  );
}

/** Lean projection: omits `text` (the heavy Ask/Show HTML body); useItemWithComments fills it back in. */
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

function parseRecord(value: unknown): SwipePosition | null {
  const parsed = value as Partial<SwipePosition> | null;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.savedAt !== 'number' ||
    typeof parsed.storyId !== 'number' ||
    !parsed.viewer ||
    typeof parsed.viewer !== 'object' ||
    !Array.isArray(parsed.stories)
  ) {
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
}

function writeRecords(records: SwipePosition[]): void {
  if (records.length === 0) {
    sessionStorage.removeItem(SWIPE_POSITION_KEY);
  } else {
    sessionStorage.setItem(SWIPE_POSITION_KEY, JSON.stringify(records));
  }
}

/** Valid, unexpired records, newest first. Drops the rest from storage. */
function readRecords(): SwipePosition[] {
  let entries: unknown[];
  try {
    const raw = sessionStorage.getItem(SWIPE_POSITION_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // A single record is the format written before positions were kept per viewer.
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }

  const now = Date.now();
  const records = entries
    .map(parseRecord)
    .filter((r): r is SwipePosition => r !== null && now - r.savedAt <= SWIPE_POSITION_TTL_MS);

  if (records.length !== entries.length) {
    try {
      writeRecords(records);
    } catch {
      /* best-effort */
    }
  }
  return records;
}

/**
 * Persist the current position for `record.viewer`, replacing that viewer's
 * previous one: stores the scrollback from the front (index 0) through a small
 * look-ahead past `index`, so `stories[index].id === storyId` holds and a reload
 * rebuilds the list in feed order. Best-effort (quota / serialization failures
 * are swallowed).
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
    const others = readRecords().filter(r => !sameViewer(r.viewer, record.viewer));
    writeRecords([payload, ...others].slice(0, SWIPE_POSITION_MAX_VIEWERS));
  } catch {
    /* quota / serialization — non-critical */
  }
}

/**
 * The newest snapshot matching every given field (any snapshot when none are
 * given), or null if there is none. Corrupt and expired entries are removed.
 */
export function readSwipePosition(
  match: { viewer?: LocationState; storyId?: number } = {},
): SwipePosition | null {
  return (
    readRecords().find(
      r =>
        (match.viewer === undefined || sameViewer(r.viewer, match.viewer)) &&
        (match.storyId === undefined || r.storyId === match.storyId),
    ) ?? null
  );
}

/** Remove `viewer`'s snapshot, or every snapshot when no viewer is given. */
export function clearSwipePosition(viewer?: LocationState): void {
  try {
    if (viewer === undefined) {
      sessionStorage.removeItem(SWIPE_POSITION_KEY);
    } else {
      writeRecords(readRecords().filter(r => !sameViewer(r.viewer, viewer)));
    }
  } catch {
    /* best-effort */
  }
}

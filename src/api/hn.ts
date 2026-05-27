import { ALGOLIA_API } from '../config/api';
import { hnSdk } from './hnSdk';
import type { Item, StoryItem, Comment, AlgoliaHit, AlgoliaComment, AlgoliaSearchResponse, FirebaseItem, PrefetchResult, AlgoliaItemResponse, AlgoliaItemChild } from '../types';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

let bestStoriesCache: { ids: number[] | null; timestamp: number } = { ids: null, timestamp: 0 };
let showStoriesCache: { ids: number[] | null; timestamp: number } = { ids: null, timestamp: 0 };
let askStoriesCache: { ids: number[] | null; timestamp: number } = { ids: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** @internal Testing helper to reset module-level caches between tests. */
export function __resetFetchCachesForTests() {
  bestStoriesCache = { ids: null, timestamp: 0 };
  showStoriesCache = { ids: null, timestamp: 0 };
  askStoriesCache = { ids: null, timestamp: 0 };
}

function getDayRange(daysAgo = 0) {
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  
  const targetDay = new Date(startOfToday);
  targetDay.setUTCDate(targetDay.getUTCDate() - daysAgo);
  
  const nextDay = new Date(targetDay);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  
  return {
    start: Math.floor(targetDay.getTime() / 1000),
    end: Math.floor(nextDay.getTime() / 1000),
  };
}

// Feed endpoints only return stories.
export function normalizeAlgoliaHit(hit: AlgoliaHit): StoryItem {
  return {
    id: parseInt(hit.objectID, 10),
    title: hit.title,
    url: hit.url ?? undefined,
    text: hit.story_text ?? undefined,
    points: hit.points,
    author: hit.author,
    createdAt: hit.created_at_i * 1000,
    commentCount: hit.num_comments || 0,
    type: hit._tags?.includes('ask_hn') ? 'ask' : hit._tags?.includes('show_hn') ? 'show' : 'story',
  };
}

function normalizeFirebaseItem(fbItem: FirebaseItem): Item {
  const base = {
    id: fbItem.id,
    author: fbItem.by ?? '',
    createdAt: (fbItem.time ?? 0) * 1000,
  };

  if (fbItem.type === 'comment') {
    return {
      ...base,
      type: 'comment' as const,
      text: fbItem.text ?? '',
      parent: fbItem.parent ?? 0,
    };
  }

  if (fbItem.type === 'job') {
    return {
      ...base,
      type: 'job' as const,
      title: fbItem.title ?? '',
      url: fbItem.url,
      text: fbItem.text,
      points: fbItem.score ?? 0,
    };
  }

  // Firebase doesn't distinguish ask/show — they're all type='story'.
  // Only the Algolia path (via _tags) can set 'ask'/'show' sub-types.
  return {
    ...base,
    type: 'story' as const,
    title: fbItem.title ?? '',
    url: fbItem.url,
    text: fbItem.text,
    points: fbItem.score ?? 0,
    commentCount: fbItem.descendants ?? 0,
  };
}

/**
 * Top stories from HN's official ranked list. Items are returned in HN's
 * native ranking order (no local gravity approximation needed).
 */
export async function fetchTopStories(limit = 20): Promise<StoryItem[]> {
  const allIds = await hnSdk.readRankedIds('topstories');
  const stories: StoryItem[] = [];
  let cursor = 0;

  while (stories.length < limit && cursor < allIds.length) {
    const batchIds = allIds.slice(cursor, cursor + limit * 2);
    const items = await Promise.all(
      batchIds.map(id => hnSdk.readItem(id).catch(() => null))
    );
    for (const item of items) {
      if (stories.length >= limit) break;
      if (!item || item.deleted || item.dead) continue;
      if (item.type === 'job') continue;
      const title = (item.title ?? '').toLowerCase();
      if (title.includes('who is hiring') || title.includes('who wants to be hired')) continue;
      stories.push(normalizeFirebaseToStoryItem(item));
    }
    cursor += batchIds.length;
  }

  return stories;
}

// Algolia's front_page tag only shows the CURRENT front page, not historical.
// So we fetch stories created on `daysAgo` sorted by points (best approximation).
export async function fetchFrontPageForDay(daysAgo = 1): Promise<StoryItem[]> {
  const { start, end } = getDayRange(daysAgo);
  
  // story tag excludes jobs/comments/polls; relevance sort factors in points.
  const url = `${ALGOLIA_API}/search?tags=story&numericFilters=created_at_i>=${start},created_at_i<${end}&hitsPerPage=30`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch front page stories: ${response.status}`);
  }
  
  const data = await response.json() as AlgoliaSearchResponse;
  
  const filtered = data.hits.filter((hit) => {
    if (hit.type === 'job' || hit._tags?.includes('job')) {
      return false;
    }
    const title = (hit.title || '').toLowerCase();
    if (title.includes('who is hiring') || 
        title.includes('who wants to be hired') ||
        title.includes('freelancer?') ||
        title.includes('seeking freelancer')) {
      return false;
    }
    return true;
  });
  
  const sorted = filtered.sort((a, b) => (b.points || 0) - (a.points || 0));
  
  return sorted.map(normalizeAlgoliaHit);
}

export async function fetchBestStories(offset = 0, limit = 30) {
  const now = Date.now();
  
  if (!bestStoriesCache.ids || (now - bestStoriesCache.timestamp) >= CACHE_TTL) {
    bestStoriesCache = { ids: await hnSdk.readRankedIds('beststories'), timestamp: now };
  }
  
  const allIds = bestStoriesCache.ids ?? [];
  const pageIds = allIds.slice(offset, offset + limit);
  
  if (pageIds.length === 0) {
    return { stories: [] as StoryItem[], hasMore: false, nextOffset: offset };
  }
  
  const fetched = await Promise.all(
    pageIds.map((id: number) => hnSdk.readItem(id).catch(() => null))
  );
  
  const stories = fetched
    .filter((fb): fb is FirebaseItem => fb != null && !fb.deleted && !fb.dead && fb.type !== 'job')
    .map(fb => normalizeFirebaseToStoryItem(fb));
  
  return {
    stories,
    hasMore: offset + limit < allIds.length,
    nextOffset: offset + limit,
  };
}

function normalizeFirebaseToStoryItem(fb: FirebaseItem): StoryItem {
  return {
    id: fb.id,
    type: 'story',
    title: fb.title ?? '',
    url: fb.url,
    text: fb.text,
    points: fb.score ?? 0,
    author: fb.by ?? '',
    createdAt: (fb.time ?? 0) * 1000,
    commentCount: fb.descendants ?? 0,
  };
}

async function fetchRankedStories(
  list: string,
  cache: { ids: number[] | null; timestamp: number },
  type: 'show' | 'ask',
  offset = 0,
  limit = 20,
) {
  const now = Date.now();
  if (!cache.ids || (now - cache.timestamp) >= CACHE_TTL) {
    cache.ids = await hnSdk.readRankedIds(list);
    cache.timestamp = now;
  }

  const allIds = cache.ids ?? [];
  const pageIds = allIds.slice(offset, offset + limit);

  if (pageIds.length === 0) {
    return { stories: [] as StoryItem[], hasMore: false, nextOffset: offset };
  }

  const items = await Promise.all(
    pageIds.map(id => hnSdk.readItem(id).catch(() => null))
  );

  const stories = items
    .filter((fb): fb is FirebaseItem => fb != null && !fb.deleted && !fb.dead)
    .map(fb => ({ ...normalizeFirebaseToStoryItem(fb), type: type }));

  return {
    stories,
    hasMore: offset + limit < allIds.length,
    nextOffset: offset + limit,
  };
}

export function fetchShowStories(offset = 0) {
  return fetchRankedStories('showstories', showStoriesCache, 'show', offset);
}

export function fetchAskStories(offset = 0) {
  return fetchRankedStories('askstories', askStoriesCache, 'ask', offset);
}

export async function fetchFirebaseItem(id: number | string, signal?: AbortSignal): Promise<FirebaseItem> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const item = await hnSdk.readItem(id);
  if (item == null) {
    throw new NotFoundError(`Item ${id} not found`);
  }
  return item;
}

// Algolia is much faster than Firebase here — 1-2 requests instead of hundreds
// of recursive item fetches.
async function fetchAllCommentsAlgolia(itemId: number, signal?: AbortSignal): Promise<AlgoliaComment[]> {
  const allComments: AlgoliaComment[] = [];
  let page = 0;
  const hitsPerPage = 200; // Algolia max
  
  while (true) {
    if (signal?.aborted) return allComments;
    
    const url = `${ALGOLIA_API}/search?tags=comment,story_${itemId}&hitsPerPage=${hitsPerPage}&page=${page}`;
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.status}`);
    }
    
    const data = await response.json() as AlgoliaSearchResponse<AlgoliaComment>;
    allComments.push(...data.hits);
    
    if (data.hits.length < hitsPerPage || allComments.length >= data.nbHits) {
      break;
    }
    page++;
    
    // Safety limit to prevent infinite loops
    if (page > 10) break;
  }
  
  return allComments;
}

// `kidsOrder` (from Firebase kids arrays) maintains HN's ranking order; falls
// back to creation time when not available.
function buildCommentTree(comments: AlgoliaComment[], itemId: number, kidsOrder = new Map<number, number[]>()): Comment[] {
  const commentMap = new Map<number, Comment>();
  
  comments.forEach((comment: AlgoliaComment) => {
    if (comment.author) { // Skip deleted comments (no author)
      commentMap.set(parseInt(comment.objectID, 10), {
        id: parseInt(comment.objectID, 10),
        author: comment.author,
        text: comment.comment_text,
        createdAt: comment.created_at_i * 1000,
        parentId: comment.parent_id,
        children: [],
      });
    }
  });
  
  const rootComments: Comment[] = [];
  
  commentMap.forEach(comment => {
    if (comment.parentId === itemId) {
      rootComments.push(comment);
    } else {
      const parent = commentMap.get(comment.parentId);
      if (parent) {
        parent.children.push(comment);
      }
      // Parent not in map → parent is dead/deleted. HN hides the entire
      // subtree under a dead comment, so we drop the orphan (its children
      // still attach to it in the map but the subtree is unreachable).
    }
  });
  
  const sortByHNOrder = (parentId: number) => (a: Comment, b: Comment) => {
    const order = kidsOrder.get(parentId);
    if (order) {
      const aIndex = order.indexOf(a.id);
      const bIndex = order.indexOf(b.id);
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      // Only one found in the kids order — put it first.
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
    }
    // Fallback: creation time, oldest first.
    return a.createdAt - b.createdAt;
  };
  
  const processTree = (commentList: Comment[], parentId: number) => {
    commentList.sort(sortByHNOrder(parentId));
    commentList.forEach(comment => {
      if (comment.children.length > 0) {
        processTree(comment.children, comment.id);
      }
    });
  };
  
  processTree(rootComments, itemId);
  
  return rootComments;
}

async function buildOrderedCommentTree(
  comments: AlgoliaComment[],
  itemId: number,
  itemKids: number[] | undefined,
  signal?: AbortSignal,
  maxOrderingDepth = Infinity,
): Promise<Comment[]> {
  const kidsOrder = new Map<number, number[]>();
  if (itemKids) {
    kidsOrder.set(itemId, itemKids);
  }

  const childrenCount = new Map<number, number>();
  comments.forEach((c: AlgoliaComment) => {
    const count = childrenCount.get(c.parent_id) ?? 0;
    childrenCount.set(c.parent_id, count + 1);
  });

  let parentsNeedingOrder: number[];

  if (maxOrderingDepth < Infinity) {
    const commentDepths = new Map<number, number>();
    const commentParents = new Map<number, number>();
    comments.forEach(c => {
      commentParents.set(parseInt(c.objectID, 10), c.parent_id);
    });

    const getDepth = (commentId: number): number => {
      if (commentDepths.has(commentId)) return commentDepths.get(commentId)!;
      const parentId = commentParents.get(commentId);
      if (parentId === undefined || parentId === itemId) {
        commentDepths.set(commentId, 0);
        return 0;
      }
      if (!commentParents.has(parentId)) {
        commentDepths.set(commentId, 0);
        return 0;
      }
      const depth = getDepth(parentId) + 1;
      commentDepths.set(commentId, depth);
      return depth;
    };

    comments.forEach(c => getDepth(Number(c.objectID)));

    parentsNeedingOrder = [...childrenCount.entries()]
      .filter(([parentId, count]: [number, number]) => {
        if (count <= 1 || parentId === itemId) return false;
        const parentDepth = commentDepths.get(parentId) ?? -1;
        return parentDepth >= 0 && parentDepth < maxOrderingDepth;
      })
      .map(([parentId]) => parentId);
  } else {
    parentsNeedingOrder = [...childrenCount.entries()]
      .filter(([parentId, count]: [number, number]) => count > 1 && parentId !== itemId)
      .map(([parentId]) => parentId);
  }

  const nestedKidsOrder = await fetchKidsOrdering(parentsNeedingOrder, signal);
  nestedKidsOrder.forEach((kids, parentId) => kidsOrder.set(parentId, kids));

  return buildCommentTree(comments, itemId, kidsOrder);
}

/** Fetch item metadata only (no comments). */
export async function fetchItemOnly(id: number | string, signal?: AbortSignal): Promise<Item> {
  const itemId = Number(id);
  const item = await fetchFirebaseItem(itemId, signal);
  return normalizeFirebaseItem(item);
}

// Required for HN's ranking order (not chronological). Batched to avoid
// overwhelming the API.
async function fetchKidsOrdering(commentIds: number[], signal?: AbortSignal): Promise<Map<number, number[]>> {
  const BATCH_SIZE = 10; // Reduced from 20 to lower concurrent requests
  const kidsOrder = new Map<number, number[]>();
  
  for (let i = 0; i < commentIds.length; i += BATCH_SIZE) {
    if (signal?.aborted) return kidsOrder;
    
    const batch = commentIds.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const item = await hnSdk.readItem(id);
          if (item?.kids) {
            return { id: item.id, kids: item.kids };
          }
          return null;
        } catch {
          return null;
        }
      })
    );
    
    results.forEach((result: { id: number; kids: number[] } | null) => {
      if (result) {
        kidsOrder.set(result.id, result.kids);
      }
    });
  }
  
  return kidsOrder;
}

/**
 * Background prefetch — silent failures, returns null on any error.
 */
export async function prefetchItemComments(id: number | string, signal?: AbortSignal, maxOrderingDepth = Infinity): Promise<PrefetchResult | null> {
  try {
    const itemId = Number(id);
    
    if (signal?.aborted) return null;
    
    const [item, comments] = await Promise.all([
      fetchFirebaseItem(itemId, signal),
      fetchAllCommentsAlgolia(itemId, signal),
    ]);
    
    if (signal?.aborted) return null;
    if (!item) return null;
    
    const commentTree = await buildOrderedCommentTree(comments, itemId, item.kids, signal, maxOrderingDepth);
    
    if (signal?.aborted) return null;
    
    return {
      item: normalizeFirebaseItem(item),
      comments: commentTree,
    };
  } catch {
    return null;
  }
}

export async function fetchCommentsForItem(id: number | string, signal: AbortSignal | null = null): Promise<Comment[]> {
  const itemId = Number(id);
  
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  
  const [item, comments] = await Promise.all([
    fetchFirebaseItem(itemId, signal ?? undefined),
    fetchAllCommentsAlgolia(itemId, signal ?? undefined),
  ]);
  
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  
  return buildOrderedCommentTree(comments, itemId, item?.kids, signal ?? undefined);
}

// Algolia /items/{id} returns the full nested children tree in one request.
export async function fetchAlgoliaItem(id: number | string, signal?: AbortSignal): Promise<AlgoliaItemResponse> {
  const response = await fetch(`${ALGOLIA_API}/items/${id}`, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch item ${id}: ${response.status}`);
  }
  return response.json() as Promise<AlgoliaItemResponse>;
}

export function normalizeAlgoliaItemChildren(children: AlgoliaItemChild[]): Comment[] {
  return children
    .filter(child => child.author) // skip deleted comments (no author)
    .map(child => ({
      id: child.id,
      author: child.author!,
      text: child.text ?? '',
      createdAt: child.created_at_i * 1000,
      parentId: child.parent_id,
      children: normalizeAlgoliaItemChildren(child.children ?? []),
    }));
}

// Format timestamp as a localized absolute date string for tooltips.
// Guards reject null/undefined/zero (`!timestamp`), NaN, AND ±Infinity —
// the latter would otherwise slip through (`!Infinity` is false,
// `isNaN(Infinity)` is false) and produce a literal "Invalid Date" string.
export function formatAbsoluteTime(timestamp: number): string {
  if (!timestamp || !isFinite(timestamp) || isNaN(timestamp)) return '';
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// Long-month date-only (e.g. "October 9, 2006") for profile creation dates
// where minute precision isn't meaningful.
export function formatAbsoluteDate(timestamp: number): string {
  if (!timestamp || !isFinite(timestamp) || isNaN(timestamp)) return '';
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

// Safe ISO string for <time> dateTime — isFinite gate required because
// Date#toISOString throws RangeError on non-finite inputs.
export function safeISOString(timestamp: number): string {
  if (!timestamp || !isFinite(timestamp) || isNaN(timestamp)) return '';
  return new Date(timestamp).toISOString();
}

// Relative time (e.g. "3 hours ago").
export function formatTimeAgo(timestamp: number): string {
  if (!timestamp || !isFinite(timestamp) || isNaN(timestamp)) {
    return '';
  }
  
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 0) {
    return 'just now';
  }
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  
  if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

// HN uses literal 'unknown' for missing/anonymous authors (degraded Algolia
// payloads), and empty strings slip through ?? '' fallbacks. Both suppress
// the link and OP badge. Type predicate for narrowing in router templates.
export function isKnownAuthor(
  author: string | null | undefined,
): author is string {
  return !!author && author !== 'unknown';
}

/** Hostname from URL; for GitHub-like hosts, includes the first path segment. */
export function getHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.replace(/^www\./, '');
    
    // For GitHub and similar sites, include the username/org in the display
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const domainsWithPath = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];
    
    if (domainsWithPath.includes(hostname) && pathParts.length > 0) {
      hostname = `${hostname}/${pathParts[0]}`;
    }
    
    return hostname;
  } catch {
    return null;
  }
}

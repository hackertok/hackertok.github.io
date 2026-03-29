import { ALGOLIA_API, FIREBASE_API } from '../config/api';
import type { Item, StoryItem, Comment, AlgoliaHit, AlgoliaComment, AlgoliaSearchResponse, FirebaseItem, PrefetchResult, AlgoliaItemResponse, AlgoliaItemChild } from '../types';

// Cache for best story IDs to avoid refetching on every pagination
let bestStoriesCache: { ids: number[] | null; timestamp: number } = { ids: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// HN's gravity constant for ranking
const HN_GRAVITY = 1.8;

/**
 * Calculate HN ranking score using gravity algorithm
 * score = (points - 1) / pow((hoursAgo + 2), gravity)
 */
function calculateHNScore(points: number, createdAtMs: number): number {
  const hoursAgo = (Date.now() - createdAtMs) / (1000 * 60 * 60);
  return (points - 1) / Math.pow(hoursAgo + 2, HN_GRAVITY);
}

// Get start and end timestamps for a specific day (UTC)
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

// Normalize Algolia hit → StoryItem (feed endpoints only return stories)
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

// Normalize Firebase item → discriminated Item union
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

  // story, poll, pollopt, or undefined → StoryItem
  // Note: Firebase doesn't distinguish ask/show — they're all type='story'.
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
 * Fetch current front page stories from Algolia (single request, fast)
 * Applies HN's gravity algorithm for approximate ranking
 */
export async function fetchTopStories(limit = 20): Promise<StoryItem[]> {
  const url = `${ALGOLIA_API}/search?tags=front_page&hitsPerPage=${limit}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch top stories: ${response.status}`);
  }
  
  const data = await response.json() as AlgoliaSearchResponse;
  
  // Filter out job posts and normalize
  const stories = data.hits
    .filter((hit) => {
      if (hit.type === 'job' || hit._tags?.includes('job')) return false;
      const title = (hit.title || '').toLowerCase();
      if (title.includes('who is hiring') || title.includes('who wants to be hired')) return false;
      return true;
    })
    .map(normalizeAlgoliaHit);
  
  // Sort by HN gravity score (approximate HN ranking)
  stories.sort((a, b) => {
    const scoreA = calculateHNScore(a.points, a.createdAt);
    const scoreB = calculateHNScore(b.points, b.createdAt);
    return scoreB - scoreA;
  });
  
  return stories;
}

// Fetch historical top stories for a specific day using Algolia
// Note: Algolia's front_page tag only shows CURRENT front page, not historical.
// So we fetch stories created on that day, sorted by points (best approximation).
export async function fetchFrontPageForDay(daysAgo = 1): Promise<StoryItem[]> {
  const { start, end } = getDayRange(daysAgo);
  
  // Use story tag (excludes jobs, comments, polls) and filter by creation date
  // Sort by relevance (which factors in points) to get the day's top stories
  const url = `${ALGOLIA_API}/search?tags=story&numericFilters=created_at_i>=${start},created_at_i<${end}&hitsPerPage=30`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch front page stories: ${response.status}`);
  }
  
  const data = await response.json() as AlgoliaSearchResponse;
  
  // Filter out job-related posts and sort by points descending
  const filtered = data.hits.filter((hit) => {
    // Skip if type is job
    if (hit.type === 'job' || hit._tags?.includes('job')) {
      return false;
    }
    // Skip hiring/job-related posts by title
    const title = (hit.title || '').toLowerCase();
    if (title.includes('who is hiring') || 
        title.includes('who wants to be hired') ||
        title.includes('freelancer?') ||
        title.includes('seeking freelancer')) {
      return false;
    }
    return true;
  });
  
  // Sort by points descending (most popular first)
  const sorted = filtered.sort((a, b) => (b.points || 0) - (a.points || 0));
  
  return sorted.map(normalizeAlgoliaHit);
}

// Fetch best stories using Firebase API (matches HN's /best page)
// Returns a batch of stories for pagination
export async function fetchBestStories(offset = 0, limit = 30) {
  const now = Date.now();
  
  // Check cache
  if (!bestStoriesCache.ids || (now - bestStoriesCache.timestamp) >= CACHE_TTL) {
    const response = await fetch(`${FIREBASE_API}/beststories.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch best stories: ${response.status}`);
    }
    bestStoriesCache = { ids: await response.json() as number[], timestamp: now };
  }
  
  const allIds = bestStoriesCache.ids ?? [];
  const pageIds = allIds.slice(offset, offset + limit);
  
  if (pageIds.length === 0) {
    return { stories: [] as StoryItem[], hasMore: false, nextOffset: offset };
  }
  
  // Fetch item details in parallel
  const fetched = await Promise.all(
    pageIds.map((id: number) => fetchFirebaseItem(id).catch(() => null))
  );
  
  // Filter out failed fetches, deleted, dead, and job posts; normalize to StoryItem
  const stories = fetched
    .filter((fb): fb is FirebaseItem => fb != null && !fb.deleted && !fb.dead && fb.type !== 'job')
    .map(fb => normalizeFirebaseToStoryItem(fb));
  
  return {
    stories,
    hasMore: offset + limit < allIds.length,
    nextOffset: offset + limit,
  };
}

// Convert a Firebase item that's known to be a story into StoryItem
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

/**
 * Fetch tagged stories (Show HN or Ask HN) for a specific 24-hour window
 * Returns top 20 stories from that day sorted by HN gravity algorithm
 * Skips empty days automatically (up to 30 consecutive empty days)
 */
async function fetchTaggedStories(tag: string, windowIndex = 0) {
  const now = Math.floor(Date.now() / 1000);
  const maxEmptyDays = 30;
  
  let currentWindow = windowIndex;
  let attempts = 0;
  
  while (attempts < maxEmptyDays) {
    const windowStart = now - ((currentWindow + 1) * 24 * 60 * 60);
    const windowEnd = now - (currentWindow * 24 * 60 * 60);
    
    const url = `${ALGOLIA_API}/search?tags=${tag}&numericFilters=created_at_i>${windowStart},created_at_i<=${windowEnd}&hitsPerPage=100`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${tag} stories: ${response.status}`);
    }
    
    const data = await response.json() as AlgoliaSearchResponse;
    const stories = data.hits.map(normalizeAlgoliaHit);
    
    if (stories.length > 0) {
      stories.sort((a, b) => {
        const scoreA = calculateHNScore(a.points, a.createdAt);
        const scoreB = calculateHNScore(b.points, b.createdAt);
        return scoreB - scoreA;
      });
      
      return {
        stories: stories.slice(0, 20),
        hasMore: true,
        nextWindow: currentWindow + 1,
      };
    }
    
    currentWindow++;
    attempts++;
  }
  
  return {
    stories: [] as StoryItem[],
    hasMore: false,
    nextWindow: currentWindow,
  };
}

/** Fetch Show HN stories */
export function fetchShowStories(windowIndex = 0) {
  return fetchTaggedStories('show_hn', windowIndex);
}

/** Fetch Ask HN stories */
export function fetchAskStories(windowIndex = 0) {
  return fetchTaggedStories('ask_hn', windowIndex);
}

// Fetch a single item from Firebase API (for item details)
// Optionally accepts AbortSignal for cancellation
export async function fetchFirebaseItem(id: number | string, signal?: AbortSignal): Promise<FirebaseItem> {
  const response = await fetch(`${FIREBASE_API}/item/${id}.json`, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch item ${id}: ${response.status}`);
  }
  return response.json() as Promise<FirebaseItem>;
}

// Fetch all comments for an item using Algolia (much faster - 1-2 requests instead of hundreds)
// Accepts optional AbortSignal for cancellation
async function fetchAllCommentsAlgolia(itemId: number, signal?: AbortSignal): Promise<AlgoliaComment[]> {
  const allComments: AlgoliaComment[] = [];
  let page = 0;
  const hitsPerPage = 200; // Algolia max
  
  // Fetch all pages of comments
  while (true) {
    // Check abort before each page
    if (signal?.aborted) return allComments;
    
    const url = `${ALGOLIA_API}/search?tags=comment,story_${itemId}&hitsPerPage=${hitsPerPage}&page=${page}`;
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.status}`);
    }
    
    const data = await response.json() as AlgoliaSearchResponse<AlgoliaComment>;
    allComments.push(...data.hits);
    
    // Check if we have more pages
    if (data.hits.length < hitsPerPage || allComments.length >= data.nbHits) {
      break;
    }
    page++;
    
    // Safety limit to prevent infinite loops
    if (page > 10) break;
  }
  
  return allComments;
}

// Build comment tree from flat list of comments
// Uses kidsOrder map to maintain HN's ranking order (from Firebase kids arrays)
function buildCommentTree(comments: AlgoliaComment[], itemId: number, kidsOrder = new Map<number, number[]>()): Comment[] {
  // Create a map of all comments by ID
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
  
  // Build the tree structure
  const rootComments: Comment[] = [];
  
  commentMap.forEach(comment => {
    if (comment.parentId === itemId) {
      rootComments.push(comment);
    } else {
      const parent = commentMap.get(comment.parentId);
      if (parent) {
        parent.children.push(comment);
      } else {
        // Parent not found (might be deleted), treat as root
        rootComments.push(comment);
      }
    }
  });
  
  // Sort function that uses HN's kids order if available, else by creation time
  const sortByHNOrder = (parentId: number) => (a: Comment, b: Comment) => {
    const order = kidsOrder.get(parentId);
    if (order) {
      const aIndex = order.indexOf(a.id);
      const bIndex = order.indexOf(b.id);
      // If both found in order, sort by position
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      // If only one found, put found one first
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
    }
    // Fallback to creation time (oldest first)
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

// Shared helper: fetch kids ordering and build an ordered comment tree
// maxOrderingDepth limits how deep we fetch ordering (Infinity = all levels)
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

  // Count children per parent to identify which ones need ordering
  const childrenCount = new Map<number, number>();
  comments.forEach((c: AlgoliaComment) => {
    const count = childrenCount.get(c.parent_id) ?? 0;
    childrenCount.set(c.parent_id, count + 1);
  });

  // Determine which parents need ordering fetched
  let parentsNeedingOrder: number[];

  if (maxOrderingDepth < Infinity) {
    // Depth-limited: calculate depths and only order within limit
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
    // No depth limit: order all parents with multiple children
    parentsNeedingOrder = [...childrenCount.entries()]
      .filter(([parentId, count]: [number, number]) => count > 1 && parentId !== itemId)
      .map(([parentId]) => parentId);
  }

  const nestedKidsOrder = await fetchKidsOrdering(parentsNeedingOrder, signal);
  nestedKidsOrder.forEach((kids, parentId) => kidsOrder.set(parentId, kids));

  return buildCommentTree(comments, itemId, kidsOrder);
}

// Fetch just the item metadata (without comments)
export async function fetchItemOnly(id: number | string, signal?: AbortSignal): Promise<Item> {
  const itemId = Number(id);
  const item = await fetchFirebaseItem(itemId, signal);
  
  if (!item) {
    throw new Error(`Item ${id} not found`);
  }
  
  return normalizeFirebaseItem(item);
}

// Fetch kids ordering from Firebase for a set of comment IDs
// This is needed to maintain HN's ranking order (not chronological)
// Processes in batches to avoid overwhelming the API
// Accepts optional AbortSignal for cancellation
async function fetchKidsOrdering(commentIds: number[], signal?: AbortSignal): Promise<Map<number, number[]>> {
  const BATCH_SIZE = 10; // Reduced from 20 to lower concurrent requests
  const kidsOrder = new Map<number, number[]>();
  
  // Process in batches
  for (let i = 0; i < commentIds.length; i += BATCH_SIZE) {
    // Check abort before each batch
    if (signal?.aborted) return kidsOrder;
    
    const batch = commentIds.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const item = await fetchFirebaseItem(id, signal);
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

// Prefetch comments for an item (with AbortController support)
// Used for background prefetching - silent failures, returns { item, comments } or null
// maxOrderingDepth: only fetch HN ordering for comments up to this depth (0=top-level, 1=replies, etc.)
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
    // Silent failure for prefetch
    return null;
  }
}

// Fetch comments for an item (separate from item fetch)
// Accepts optional AbortSignal for cancellation
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

// Fetch a single item with its children tree from Algolia /items/{id} endpoint
// Returns comment/item with full nested children in a single request
export async function fetchAlgoliaItem(id: number | string, signal?: AbortSignal): Promise<AlgoliaItemResponse> {
  const response = await fetch(`${ALGOLIA_API}/items/${id}`, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch item ${id}: ${response.status}`);
  }
  return response.json() as Promise<AlgoliaItemResponse>;
}

// Recursively convert Algolia item children to Comment[] tree
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

// Format relative time
export function formatTimeAgo(timestamp: number): string {
  if (!timestamp || isNaN(timestamp)) {
    return '';
  }
  
  const now = Date.now();
  const diff = now - timestamp;
  
  // Handle future dates
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

// Get hostname from URL (includes first path segment for GitHub-like domains)
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

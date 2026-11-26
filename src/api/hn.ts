import { ALGOLIA_API } from '../config/api';
import { hnSdk } from './hnSdk';
import type { Item, StoryItem, Comment, AlgoliaHit, AlgoliaComment, AlgoliaSearchResponse, FirebaseItem, PrefetchResult, AlgoliaItemResponse, AlgoliaItemChild, PollOption, PollOptionItem } from '../types';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** The comments couldn't be read, but the item they hang off was, with a poll's options. */
export class CommentsError extends Error {
  readonly item: Item;

  constructor(message: string, item: Item) {
    super(message);
    this.name = 'CommentsError';
    this.item = item;
  }
}

const rankedIdsCache = new Map<string, { ids: number[]; timestamp: number }>();
let storyCommentsCache: { storyId: number; comments: Promise<ThreadComment[] | null>; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** @internal Testing helper to reset module-level caches between tests. */
export function __resetFetchCachesForTests() {
  rankedIdsCache.clear();
  storyCommentsCache = null;
  threadDownloads.clear();
}

const SECONDS_PER_DAY = 86_400;

// Unix time has no leap seconds, so every UTC day is exactly SECONDS_PER_DAY.
function getDayRange(daysAgo = 0) {
  const day = Math.floor(Date.now() / (SECONDS_PER_DAY * 1000)) - daysAgo;
  return { start: day * SECONDS_PER_DAY, end: (day + 1) * SECONDS_PER_DAY };
}

// Feed endpoints only return stories (polls among them).
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
    type: hit._tags?.includes('poll') ? 'poll'
      : hit._tags?.includes('ask_hn') ? 'ask'
      : hit._tags?.includes('show_hn') ? 'show'
      : 'story',
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
      text: firebaseCommentText(fbItem) ?? '',
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

  if (fbItem.type === 'pollopt') {
    return {
      ...base,
      type: 'pollopt' as const,
      text: fbItem.text ?? '',
      points: fbItem.score ?? 0,
      poll: fbItem.poll ?? 0,
    };
  }

  // Firebase doesn't distinguish ask/show — they're all type='story'.
  // Only the Algolia path (via _tags) can set 'ask'/'show' sub-types.
  // A poll's options are separate items, read with its comments.
  return normalizeFirebaseToStoryItem(fbItem);
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
      if (isHiringThread(item.title)) continue;
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
  
  // story,poll is an OR group: polls are tagged `poll`, not `story`. It still
  // leaves out jobs and comments; relevance sort factors in points.
  const url = `${ALGOLIA_API}/search?tags=(story,poll)&numericFilters=created_at_i>=${start},created_at_i<${end}&hitsPerPage=30`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch front page stories: ${response.status}`);
  }
  
  const data = await response.json() as AlgoliaSearchResponse;
  
  const filtered = data.hits.filter((hit) => {
    if (hit.type === 'job' || hit._tags?.includes('job')) {
      return false;
    }
    return !isHiringThread(hit.title);
  });
  
  const sorted = filtered.sort((a, b) => (b.points || 0) - (a.points || 0));
  
  return sorted.map(normalizeAlgoliaHit);
}

export function fetchBestStories(offset = 0, limit = 30) {
  return fetchRankedStories('beststories', offset, { limit, excludeJobs: true, excludeHiring: true });
}

// Newest feed: reverse-chronological submissions from HN `newstories` (≤500,
// HN's hard cap), filtered like the best feed.
export function fetchNewStories(offset = 0, limit = 30) {
  return fetchRankedStories('newstories', offset, { limit, excludeJobs: true, excludeHiring: true });
}

/** A poll option has no title or comments, so it gets a page of its own. */
export function isPollOption(item: Item): item is PollOptionItem {
  return item.type === 'pollopt';
}

function normalizeFirebaseToStoryItem(fb: FirebaseItem): StoryItem {
  return {
    id: fb.id,
    type: fb.type === 'poll' ? 'poll' : 'story',
    title: fb.title ?? '',
    url: fb.url,
    text: fb.text,
    points: fb.score ?? 0,
    author: fb.by ?? '',
    createdAt: (fb.time ?? 0) * 1000,
    commentCount: fb.descendants ?? 0,
  };
}

async function readRankedIdsCached(list: string): Promise<number[]> {
  const now = Date.now();
  const cached = rankedIdsCache.get(list);
  if (cached && now - cached.timestamp < CACHE_TTL) return cached.ids;
  const ids = await hnSdk.readRankedIds(list);
  rankedIdsCache.set(list, { ids, timestamp: now });
  return ids;
}

interface RankedPageOptions {
  limit: number;
  /** Firebase can't tell ask/show from story, so the list sets it. Polls keep theirs. */
  type?: 'show' | 'ask';
  excludeJobs?: boolean;
  // The whoishiring threads are type='story', not 'job', so the job filter
  // alone lets them through.
  excludeHiring?: boolean;
}

async function fetchRankedStories(
  list: string,
  offset: number,
  { limit, type, excludeJobs = false, excludeHiring = false }: RankedPageOptions,
) {
  const allIds = await readRankedIdsCached(list);
  const pageIds = allIds.slice(offset, offset + limit);

  if (pageIds.length === 0) {
    return { stories: [] as StoryItem[], hasMore: false, nextOffset: offset };
  }

  const items = await Promise.all(
    pageIds.map(id => hnSdk.readItem(id).catch(() => null))
  );

  const stories = items
    .filter((fb): fb is FirebaseItem =>
      fb != null &&
      !fb.deleted &&
      !fb.dead &&
      !(excludeJobs && fb.type === 'job') &&
      !(excludeHiring && isHiringThread(fb.title))
    )
    .map(fb => {
      const story = normalizeFirebaseToStoryItem(fb);
      return type && story.type !== 'poll' ? { ...story, type } : story;
    });

  return {
    stories,
    hasMore: offset + limit < allIds.length,
    nextOffset: offset + limit,
  };
}

export function fetchShowStories(offset = 0) {
  return fetchRankedStories('showstories', offset, { limit: 20, type: 'show' });
}

// Ask excludes the whoishiring threads, matching fetchAskStoriesForDay. Show is
// left unfiltered: a Show HN title mentioning hiring is a real project.
export function fetchAskStories(offset = 0) {
  return fetchRankedStories('askstories', offset, { limit: 20, type: 'ask', excludeHiring: true });
}

/**
 * Fetch stories for a specific day from Algolia, filtered by tag.
 * Used for historical fallback when Firebase ranked lists are exhausted.
 */
export async function fetchTaggedStoriesForDay(
  tag: 'ask_hn' | 'show_hn',
  daysAgo: number,
  excludeTitles?: string[],
): Promise<StoryItem[]> {
  const { start, end } = getDayRange(daysAgo);
  const url = `${ALGOLIA_API}/search?tags=story,${tag}&numericFilters=created_at_i>=${start},created_at_i<${end}&hitsPerPage=30`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${tag} stories: ${response.status}`);
  }

  const data = await response.json() as AlgoliaSearchResponse;

  let hits = data.hits;
  if (excludeTitles && excludeTitles.length > 0) {
    hits = hits.filter((hit) => {
      const title = (hit.title || '').toLowerCase();
      return !excludeTitles.some(t => title.includes(t));
    });
  }

  const sorted = hits.sort((a, b) => (b.points || 0) - (a.points || 0));
  return sorted.map(normalizeAlgoliaHit);
}

const HIRING_EXCLUDE_TITLES = [
  'who is hiring',
  'who wants to be hired',
];

function isHiringThread(title: string | undefined): boolean {
  const lower = (title ?? '').toLowerCase();
  return HIRING_EXCLUDE_TITLES.some(t => lower.includes(t));
}

export function fetchAskStoriesForDay(daysAgo: number): Promise<StoryItem[]> {
  return fetchTaggedStoriesForDay('ask_hn', daysAgo, HIRING_EXCLUDE_TITLES);
}

export function fetchShowStoriesForDay(daysAgo: number): Promise<StoryItem[]> {
  return fetchTaggedStoriesForDay('show_hn', daysAgo);
}

export async function fetchFirebaseItem(id: number | string, signal?: AbortSignal): Promise<FirebaseItem> {
  signal?.throwIfAborted();
  const item = await hnSdk.readItem(id);
  if (item == null) {
    throw new NotFoundError(`Item ${id} not found`);
  }
  return item;
}

/**
 * The comments among `ids` that a thread leaves out: flagged and deleted ones
 * with no replies. Never `keepId`, so a link to it still opens, nor one whose
 * read fails.
 */
export async function fetchHiddenCommentIds(ids: number[], keepId: number, signal?: AbortSignal): Promise<Set<number>> {
  const items = await Promise.all(ids.map(id => hnSdk.readItem(id).catch(() => null)));
  signal?.throwIfAborted();
  return new Set(ids.filter((id, i) => {
    const item = items[i];
    return id !== keepId && !!item && !item.kids?.length && (!!item.dead || !!item.deleted);
  }));
}

// Search returns at most 1,000 hits, and a page can hold all of them.
const SEARCH_HITS_PER_PAGE = 1000;
// Only the fields a comment needs, without the highlighted copy of each one:
// 70% less to download, and Algolia doesn't compress it.
const SEARCH_COMMENT_FIELDS = 'attributesToRetrieve=author,comment_text,created_at_i,parent_id&attributesToHighlight=%5B%5D';

// Algolia is much faster than Firebase here: one request instead of hundreds
// of recursive item reads. A thread bigger than search returns is capped.
async function searchItemComments(itemId: number, signal?: AbortSignal): Promise<{ comments: AlgoliaComment[]; isCapped: boolean }> {
  const url = `${ALGOLIA_API}/search?tags=comment,story_${itemId}&hitsPerPage=${SEARCH_HITS_PER_PAGE}&${SEARCH_COMMENT_FIELDS}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch comments: ${response.status}`);
  }

  const data = await response.json() as AlgoliaSearchResponse<AlgoliaComment>;
  return { comments: data.hits, isCapped: data.nbHits > data.hits.length };
}

async function countItemComments(itemId: number): Promise<number> {
  const response = await fetch(`${ALGOLIA_API}/search?tags=comment,story_${itemId}&hitsPerPage=0`);
  if (!response.ok) {
    throw new Error(`Failed to count comments: ${response.status}`);
  }
  const data = await response.json() as AlgoliaSearchResponse<AlgoliaComment>;
  return data.nbHits;
}

async function fetchAllCommentsAlgolia(itemId: number, signal?: AbortSignal, itemRead?: Promise<FirebaseItem>): Promise<AlgoliaComment[]> {
  // A story with more comments than search returns will need the item tree,
  // so it downloads alongside the search. The two counts differ slightly, so
  // the tree is cancelled when search turns out to have every comment.
  const treeAbort = new AbortController();
  const abortTree = () => treeAbort.abort();
  signal?.addEventListener('abort', abortTree);
  const earlyTree = itemRead
    ?.then(raw => ((raw.descendants ?? 0) > SEARCH_HITS_PER_PAGE ? fetchAlgoliaItem(itemId, treeAbort.signal) : null))
    .catch(() => null);

  try {
    const { comments: allComments, isCapped } = await searchItemComments(itemId, signal);

    // The item endpoint has the rest of a bigger thread. It also misses a few
    // comments that search has, so it adds to search's results.
    if (isCapped && !signal?.aborted) {
      const tree = (await earlyTree) ?? await fetchAlgoliaItem(itemId, signal).catch(() => null);
      const seen = new Set(allComments.map(c => c.objectID));
      for (const comment of flattenAlgoliaItemChildren(tree?.children ?? [])) {
        if (!seen.has(comment.objectID)) allComments.push(comment);
      }
    }

    return allComments;
  } finally {
    treeAbort.abort();
    signal?.removeEventListener('abort', abortTree);
  }
}

function flattenAlgoliaItemChildren(children: AlgoliaItemChild[], into: AlgoliaComment[] = []): AlgoliaComment[] {
  for (const child of children) {
    // The item tree leaves out flagged and deleted comments along with their
    // replies, so those replies only come from search.
    if (child.author) {
      into.push({
        objectID: String(child.id),
        author: child.author,
        comment_text: child.text ?? '',
        created_at_i: child.created_at_i,
        parent_id: child.parent_id,
      });
    }
    flattenAlgoliaItemChildren(child.children ?? [], into);
  }
  return into;
}

type ThreadComment = AlgoliaComment & { deleted?: boolean };

// Search and the item tree leave out flagged and deleted comments but keep
// their replies. HN shows those replies under a [flagged] or [deleted] row,
// so the missing parents (and theirs, when also missing) come from Firebase.
async function fetchMissingParents(comments: AlgoliaComment[], itemId: number, signal?: AbortSignal): Promise<FirebaseItem[]> {
  const MAX_DEPTH = 10;
  const known = new Set(comments.map(c => Number(c.objectID)));
  const found: FirebaseItem[] = [];
  let missing = [...new Set(comments.map(c => c.parent_id))].filter(id => id !== itemId && !known.has(id));

  for (let depth = 0; depth < MAX_DEPTH && missing.length > 0 && !signal?.aborted; depth++) {
    const next = new Set<number>();
    for (const item of await readItems(missing, signal)) {
      if (item.parent == null) continue;
      known.add(item.id);
      found.push(item);
      if (item.parent !== itemId) next.add(item.parent);
    }
    missing = [...next].filter(id => !known.has(id));
  }

  return found;
}

// Firebase still has the text of older killed comments. HN shows [flagged].
function firebaseCommentText(item: FirebaseItem): string | undefined {
  return item.dead && item.text ? '[flagged]' : item.text;
}

function threadCommentFromFirebase(item: FirebaseItem): ThreadComment {
  return {
    objectID: String(item.id),
    author: item.by ?? '',
    comment_text: firebaseCommentText(item) ?? '',
    created_at_i: item.time ?? 0,
    parent_id: item.parent ?? 0,
    deleted: item.deleted === true || !item.by,
  };
}

// `kidsOrder` (from Firebase kids arrays) maintains HN's ranking order; falls
// back to creation time when not available.
function buildCommentTree(comments: ThreadComment[], itemId: number, kidsOrder = new Map<number, number[]>()): Comment[] {
  const commentMap = new Map<number, Comment>();
  
  comments.forEach((comment: ThreadComment) => {
    if (comment.author || comment.deleted) {
      commentMap.set(parseInt(comment.objectID, 10), {
        id: parseInt(comment.objectID, 10),
        author: comment.author,
        text: comment.comment_text,
        createdAt: comment.created_at_i * 1000,
        parentId: comment.parent_id,
        children: [],
        ...(comment.deleted && { deleted: true }),
      });
    }
  });
  
  const rootComments: Comment[] = [];
  
  commentMap.forEach(comment => {
    if (comment.parentId === itemId) {
      rootComments.push(comment);
    } else {
      // Orphans whose parent Firebase couldn't supply either are dropped.
      commentMap.get(comment.parentId)?.children.push(comment);
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
  searchComments: AlgoliaComment[],
  itemId: number,
  itemKids: number[] | undefined,
  signal?: AbortSignal,
): Promise<Comment[]> {
  const kidsOrder = new Map<number, number[]>();
  if (itemKids) {
    kidsOrder.set(itemId, itemKids);
  }

  const missingParents = await fetchMissingParents(searchComments, itemId, signal);
  missingParents.forEach(parent => {
    if (parent.kids) kidsOrder.set(parent.id, parent.kids);
  });
  const comments: ThreadComment[] = [...searchComments, ...missingParents.map(threadCommentFromFirebase)];

  const childrenCount = new Map<number, number>();
  comments.forEach((c: AlgoliaComment) => {
    const count = childrenCount.get(c.parent_id) ?? 0;
    childrenCount.set(c.parent_id, count + 1);
  });

  const parentsNeedingOrder = [...childrenCount.entries()]
    .filter(([parentId, count]: [number, number]) => count > 1 && parentId !== itemId)
    .map(([parentId]) => parentId);

  const nestedKidsOrder = await fetchKidsOrdering(parentsNeedingOrder.filter(id => !kidsOrder.has(id)), signal);
  nestedKidsOrder.forEach((kids, parentId) => kidsOrder.set(parentId, kids));

  return buildCommentTree(comments, itemId, kidsOrder);
}

/** Fetch item metadata only (no comments). A poll's options come with its comments. */
export async function fetchItemOnly(id: number | string, signal?: AbortSignal): Promise<Item> {
  return itemOnly(await fetchFirebaseItem(Number(id), signal));
}

async function itemOnly(raw: FirebaseItem): Promise<Item> {
  const item = normalizeFirebaseItem(raw);
  if (!isPollOption(item) || !item.poll) return item;

  // Its page links to the poll by title. Without one the link still works.
  const poll = await hnSdk.readItem(item.poll).catch(() => null);
  return poll?.title ? { ...item, pollTitle: poll.title } : item;
}

// Every option is read: a poll missing one would misstate the others' shares,
// so one failed read fails them all. Deleted and flagged options are left out.
// Not batched: reads share one WebSocket, so batches would only add round
// trips (seconds, for HN's biggest poll).
// They come in HN's order, most points first. The API calls `parts` display
// order, but HN's pages sort by points; the sort is stable, so ties keep it.
async function fetchPollOptions(parts: number[], signal?: AbortSignal): Promise<PollOption[]> {
  const items = await Promise.all(parts.map(id => hnSdk.readItem(id)));
  signal?.throwIfAborted();
  return items
    .filter((item): item is FirebaseItem => item != null && !item.deleted && !item.dead)
    .map(item => ({ id: item.id, text: item.text ?? '', points: item.score ?? 0 }))
    .sort((a, b) => b.points - a.points);
}

function threadItem(raw: FirebaseItem, pollOptions: PollOption[] | undefined): Item {
  const item = normalizeFirebaseItem(raw);
  return item.type === 'poll' && pollOptions ? { ...item, pollOptions } : item;
}

// The item, normalized, with its comments in HN's order. A poll's options are
// its content, so they're read too, while the comments are put in order.
// Options that can't be read leave the poll without them rather than cost it
// its comments; a copy cached that way reads them again. Comments that can't
// be read don't cost a poll its options: the CommentsError carries them.
async function fetchThread(
  itemId: number,
  signal?: AbortSignal,
  itemRead = fetchFirebaseItem(itemId, signal),
): Promise<PrefetchResult> {
  const pollOptionsRead = itemRead
    .then(raw => (raw.type === 'poll' ? fetchPollOptions(raw.parts ?? [], signal) : undefined))
    .catch(() => undefined);
  const commentsRead = fetchAllCommentsAlgolia(itemId, signal, itemRead).catch(async (err: unknown) => {
    if (signal?.aborted) throw err;
    const raw = await itemRead.catch(() => null);
    if (!raw) throw err;
    const item = threadItem(raw, await pollOptionsRead);
    signal?.throwIfAborted();
    throw new CommentsError(err instanceof Error ? err.message : String(err), item);
  });
  const [raw, comments] = await Promise.all([itemRead, commentsRead]);

  signal?.throwIfAborted();

  const [commentTree, pollOptions] = await Promise.all([
    buildOrderedCommentTree(comments, itemId, raw.kids, signal),
    pollOptionsRead,
  ]);
  return { item: threadItem(raw, pollOptions), comments: commentTree };
}

// Items that fail or don't exist are left out. Not batched: reads share one
// WebSocket, so batches would only add round trips (seconds, for a big thread).
async function readItems(ids: number[], signal?: AbortSignal): Promise<FirebaseItem[]> {
  if (signal?.aborted) return [];
  const items = await Promise.all(ids.map(id => hnSdk.readItem(id).catch(() => null)));
  return items.filter(item => item != null);
}

// Required for HN's ranking order (not chronological).
async function fetchKidsOrdering(commentIds: number[], signal?: AbortSignal): Promise<Map<number, number[]>> {
  const kidsOrder = new Map<number, number[]>();
  for (const item of await readItems(commentIds, signal)) {
    if (item.kids) kidsOrder.set(item.id, item.kids);
  }
  return kidsOrder;
}

interface ThreadDownload {
  itemRead: Promise<FirebaseItem>;
  thread: Promise<PrefetchResult>;
  controller: AbortController;
  users: number;
}
const threadDownloads = new Map<number, ThreadDownload>();

// One download per thread: the story on screen and the prefetches that want
// it at the same time share it. A caller's abort only detaches that caller,
// and the download stops once all have. It also retires the download, so a
// retry starts over rather than joining a stalled one.
function downloadThread(itemId: number, signal?: AbortSignal): { itemRead: Promise<FirebaseItem>; thread: Promise<PrefetchResult> } {
  let download = threadDownloads.get(itemId);
  if (!download) {
    const controller = new AbortController();
    const itemRead = fetchFirebaseItem(itemId, controller.signal);
    const created: ThreadDownload = { itemRead, thread: fetchThread(itemId, controller.signal, itemRead), controller, users: 0 };
    const retire = () => {
      if (threadDownloads.get(itemId) === created) threadDownloads.delete(itemId);
    };
    created.thread.then(retire, retire);
    threadDownloads.set(itemId, created);
    download = created;
  }
  const shared = download;
  shared.users++;
  if (!signal) return shared;

  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    if (threadDownloads.get(itemId) === shared) threadDownloads.delete(itemId);
    if (--shared.users === 0) shared.controller.abort();
  };
  const own = <T,>(read: Promise<T>) => new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      leave();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    read.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
  const itemRead = own(shared.itemRead);
  itemRead.catch(() => { /* a prefetch only reads the thread */ });
  return { itemRead, thread: own(shared.thread) };
}

/**
 * Background prefetch — silent failures, returns null on any error.
 */
export async function prefetchItemComments(id: number | string, signal?: AbortSignal): Promise<PrefetchResult | null> {
  try {
    if (signal?.aborted) return null;

    const result = await downloadThread(Number(id), signal).thread;

    return signal?.aborted ? null : result;
  } catch {
    return null;
  }
}

/** The comment tree plus the item it hangs off, which the ordering reads anyway. */
export async function fetchItemWithComments(id: number | string, signal: AbortSignal | null = null): Promise<PrefetchResult> {
  signal?.throwIfAborted();

  return downloadThread(Number(id), signal ?? undefined).thread;
}

/**
 * The item, and its comments without waiting to learn what it is, from one
 * read of it. For a comment or poll option, the comments' search finds none.
 */
export function fetchItemAndComments(id: number | string, signal?: AbortSignal): { item: Promise<Item>; thread: Promise<PrefetchResult> } {
  const { itemRead, thread } = downloadThread(Number(id), signal);
  return { item: itemRead.then(itemOnly), thread };
}

// Algolia /items/{id} returns the full nested children tree in one request.
export async function fetchAlgoliaItem(id: number | string, signal?: AbortSignal): Promise<AlgoliaItemResponse> {
  const response = await fetch(`${ALGOLIA_API}/items/${id}`, { signal });
  if (!response.ok) {
    const message = `Failed to fetch item ${id}: ${response.status}`;
    throw response.status === 404 ? new NotFoundError(message) : new Error(message);
  }
  return response.json() as Promise<AlgoliaItemResponse>;
}

/**
 * A comment with its reply tree, in Algolia's item shape. Algolia 404s
 * flagged and deleted comments (and ones it hasn't indexed yet), so those
 * come from Firebase, with the replies Algolia has.
 */
export async function fetchCommentItem(id: number | string, signal?: AbortSignal): Promise<AlgoliaItemResponse> {
  try {
    return await fetchAlgoliaItem(id, signal);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }

  const item = await fetchFirebaseItem(id, signal);
  const replies = (await Promise.all(
    (item.kids ?? []).map(kid => fetchAlgoliaItem(kid, signal).catch(() => null)),
  )).filter(reply => reply !== null);

  return {
    id: item.id,
    type: item.type ?? 'comment',
    author: item.by ?? null,
    text: firebaseCommentText(item) ?? null,
    created_at_i: item.time ?? 0,
    parent_id: item.parent ?? null,
    story_id: replies[0]?.story_id ?? await findStoryId(item.parent, signal),
    children: replies.map(reply => ({ ...reply, parent_id: item.id })),
  };
}

// The story a comment is on, up its parent chain: Firebase keeps flagged and
// deleted comments, which Algolia 404s. Null when a read fails.
async function findStoryId(parentId: number | undefined, signal?: AbortSignal): Promise<number | null> {
  for (let id = parentId, hops = 0; id != null && hops < 100; hops++) {
    const parent = await fetchFirebaseItem(id, signal).catch(() => null);
    if (!parent) return null;
    if (parent.type !== 'comment') return parent.id;
    id = parent.parent;
  }
  return null;
}

// A story's comments from search, with the flagged and deleted parents it
// leaves out. Null for a thread bigger than search returns. Comments next to
// each other in the swipe viewer share one read, so no caller's signal ends it.
function fetchStoryComments(storyId: number): Promise<ThreadComment[] | null> {
  if (storyCommentsCache?.storyId === storyId && Date.now() - storyCommentsCache.timestamp < CACHE_TTL) {
    return storyCommentsCache.comments;
  }

  const comments = (async () => {
    // A thread bigger than search returns is dropped, so its count, which
    // comes back well before its comments, stops the search.
    const search = new AbortController();
    countItemComments(storyId).then(
      count => { if (count > SEARCH_HITS_PER_PAGE) search.abort(); },
      () => { /* the search decides */ },
    );
    const result = await searchItemComments(storyId, search.signal).catch((err: unknown) => {
      if (search.signal.aborted) return null;
      throw err;
    });
    if (!result || result.isCapped) return null;
    const missingParents = await fetchMissingParents(result.comments, storyId);
    return [...result.comments, ...missingParents.map(threadCommentFromFirebase)];
  })();
  const entry = { storyId, comments, timestamp: Date.now() };
  storyCommentsCache = entry;
  comments.catch(() => {
    if (storyCommentsCache === entry) storyCommentsCache = null;
  });
  return comments;
}

// For a comment with no replies in the item tree. Most have none at all. The
// rest mostly have only flagged or deleted replies with nothing under them,
// which aren't shown. A live reply can still be in search without being in
// the item tree.
async function hasRepliesOutsideItemTree(id: number, signal?: AbortSignal): Promise<boolean> {
  const { kids = [] } = await fetchFirebaseItem(id, signal);
  if (kids.length === 0) return false;
  const replies = await readItems(kids, signal);
  return replies.some(reply => (reply.kids?.length ?? 0) > 0 || (!reply.dead && !reply.deleted));
}

/**
 * A comment's replies, with the flagged and deleted ones that have live
 * replies, in HN's order. Algolia's item tree leaves those out along with
 * their replies, so they come from the story's comments, as in the story
 * thread. Both come in creation order, so the order comes from Firebase.
 */
export async function fetchCommentReplies(item: AlgoliaItemResponse, signal?: AbortSignal): Promise<Comment[]> {
  if (item.story_id == null) return normalizeAlgoliaItemChildren(item.children ?? []);
  const mayHaveMore = !!item.children?.length || await hasRepliesOutsideItemTree(item.id, signal);
  signal?.throwIfAborted();
  if (!mayHaveMore) return [];

  // Null for a thread bigger than search returns, which keeps the item tree's replies.
  const storyComments = await fetchStoryComments(item.story_id);
  signal?.throwIfAborted();

  const replies = flattenAlgoliaItemChildren(item.children ?? []);
  const seen = new Set(replies.map(c => c.objectID));
  const comments = [...replies, ...(storyComments ?? []).filter(c => !seen.has(c.objectID))];
  const kidsOrder = await fetchKidsOrdering(parentsWithSiblings(buildCommentTree(comments, item.id), item.id), signal);
  return buildCommentTree(comments, item.id, kidsOrder);
}

// The ids in a reply tree whose replies need ordering: those with more than one.
function parentsWithSiblings(replies: Comment[], parentId: number, into: number[] = []): number[] {
  if (replies.length > 1) into.push(parentId);
  for (const reply of replies) parentsWithSiblings(reply.children, reply.id, into);
  return into;
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
// Guards reject null/undefined/zero (`!timestamp`), and `isFinite` rejects NaN
// and ±Infinity, which would otherwise make the formatter throw a RangeError.
// The formatter is built once: Date#toLocaleString builds a new one per call,
// which showed up in swipe profiles (every comment renders a timestamp).
const absoluteTimeFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
});
export function formatAbsoluteTime(timestamp: number): string {
  if (!timestamp || !isFinite(timestamp)) return '';
  return absoluteTimeFormat.format(timestamp);
}

// Long-month date-only (e.g. "October 9, 2006") for profile creation dates
// where minute precision isn't meaningful.
export function formatAbsoluteDate(timestamp: number): string {
  if (!timestamp || !isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

// Safe ISO string for <time> dateTime — isFinite gate required because
// Date#toISOString throws RangeError on non-finite inputs.
export function safeISOString(timestamp: number): string {
  if (!timestamp || !isFinite(timestamp)) return '';
  return new Date(timestamp).toISOString();
}

// Relative time (e.g. "3 hours ago").
export function formatTimeAgo(timestamp: number): string {
  if (!timestamp || !isFinite(timestamp)) {
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
  // 30-day months reach 12 at day 360, five days short of a year.
  const months = Math.min(Math.floor(days / 30), 11);
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

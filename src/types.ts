/**
 * Core data model types for HackerTok
 *
 * HN's API treats everything as an "item" (stories, comments, jobs, polls).
 * We use a discriminated union so TypeScript can narrow by `type`.
 */

export type FeedType = 'top' | 'show' | 'ask' | 'best' | 'newest';

interface ItemBase {
  id: number;
  author: string;
  createdAt: number;
}

export interface StoryItem extends ItemBase {
  type: 'story' | 'ask' | 'show';
  title: string;
  url?: string;
  text?: string;
  points: number;
  commentCount: number;
}

export interface CommentItem extends ItemBase {
  type: 'comment';
  text: string;
  parent: number;
}

export interface JobItem extends ItemBase {
  type: 'job';
  title: string;
  url?: string;
  text?: string;
  points: number;
}

export type Item = StoryItem | CommentItem | JobItem;

export interface Comment {
  id: number;
  author: string;
  text: string;
  createdAt: number;
  parentId: number;
  children: Comment[];
}

export interface AlgoliaHit {
  objectID: string;
  title: string;
  url?: string | null;
  points: number;
  author: string;
  created_at_i: number;
  num_comments: number;
  story_text?: string | null;
  _tags?: string[];
  type?: string;
}

export interface AlgoliaComment {
  objectID: string;
  author: string;
  comment_text: string;
  created_at_i: number;
  parent_id: number;
  _tags?: string[];
}

export interface AlgoliaSearchResponse<T = AlgoliaHit> {
  hits: T[];
  nbHits: number;
  nbPages: number;
  page: number;
  hitsPerPage: number;
}

export interface FirebaseItem {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  by?: string;
  time?: number;
  descendants?: number;
  type?: string;
  text?: string;
  kids?: number[];
  dead?: boolean;
  deleted?: boolean;
  parent?: number;
}

// Algolia /items/{id} endpoint - returns item with full children tree
export interface AlgoliaItemChild {
  id: number;
  author: string | null;
  text: string | null;
  created_at_i: number;
  parent_id: number;
  children: AlgoliaItemChild[];
}

export interface AlgoliaItemResponse {
  id: number;
  type: string;
  author: string | null;
  text: string | null;
  created_at_i: number;
  parent_id: number | null;
  story_id: number | null;
  children: AlgoliaItemChild[];
}

export interface CachedItem {
  item: Item;
  comments: Comment[];
  timestamp: number;
  isFresh: boolean;
  orderedDepth: number;
}

export interface CachedFeed {
  stories: StoryItem[];
  timestamp: number;
}

export interface ListSessionState {
  scrollY: number;
  storyIds: number[];
  position: number;
  seenIds: Set<number>;
  hasMore: boolean;
  phase?: 'firebase' | 'algolia';
}

export interface PrefetchResult {
  item: Item;
  comments: Comment[];
}

// `Theme` is the *resolved* appearance actually applied to the document.
// `ThemeMode` is the user's *preference*: an explicit pin ('light'/'dark') or
// 'system', which tracks the OS color scheme live.
export type Theme = 'light' | 'dark';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeContextValue {
  /** User preference. 'system' follows the OS scheme. */
  mode: ThemeMode;
  /** Resolved appearance currently applied ('light' | 'dark'). */
  theme: Theme;
  setMode: (mode: ThemeMode) => void;
  /** Advance the preference: system → light → dark → system. */
  cycleMode: () => void;
}

export interface ScrollContainerContextValue {
  isSwipeMode: boolean;
  enableSwipeMode: () => void;
  disableSwipeMode: () => void;
}

export interface LocationState {
  from?: FeedType;
  fromDomain?: string;
  fromUser?: string;
  isComment?: boolean;
}

// Durable per-tab snapshot (sessionStorage) for restoring the mobile swipe viewer
// after a full reload (bfcache miss). `stories` is a lean projection (omits `text`)
// of the scrollback from the front through a small look-ahead; `index` is the anchor's
// position in it and advisory — restore re-finds by `storyId`.
export interface SwipePosition {
  viewer: LocationState;
  storyId: number;
  index: number;
  scrollY: number;
  stories: StoryItem[];
  savedAt: number;
}

// Firebase /user/:id.json shape. `delay` omitted (vestigial HN field).
export interface UserProfile {
  id: string;
  created: number;       // unix seconds
  karma: number;
  about?: string;        // HTML; sanitize before rendering
  submitted: number[];
}

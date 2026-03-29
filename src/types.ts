/**
 * Core data model types for HackerTok
 *
 * HN's API treats everything as an "item" (stories, comments, jobs, polls).
 * We use a discriminated union so TypeScript can narrow by `type`.
 */

// --- Feed type (which list endpoint to fetch) ---

export type FeedType = 'top' | 'show' | 'ask' | 'best';

// --- Item variants (discriminated union) ---

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

// --- Comment types ---

export interface Comment {
  id: number;
  author: string;
  text: string;
  createdAt: number;
  parentId: number;
  children: Comment[];
}

// --- API response shapes ---

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

// --- Cache types ---

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
}

// --- Prefetch types ---

export interface PrefetchResult {
  item: Item;
  comments: Comment[];
}

// --- Theme types ---

export type Theme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

// --- Scroll container types ---

export interface ScrollContainerContextValue {
  isSwipeMode: boolean;
  enableSwipeMode: () => void;
  disableSwipeMode: () => void;
}

// --- Router types ---

export interface LocationState {
  from?: FeedType;
}

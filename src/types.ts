/**
 * Core data model types for HackerTok
 */

// --- Story types ---

export type StoryType = 'top' | 'show' | 'ask' | 'best';

export interface Story {
  id: number;
  title: string;
  url?: string;
  points: number;
  author: string;
  createdAt: number;
  commentCount: number;
  type?: string;
  text?: string;
}

// --- Comment types ---

export interface Comment {
  id: number;
  author: string;
  text: string;
  createdAt: number;
  parentId: number;
  children: Comment[];
  depth: number;
  hiddenChildCount?: number;
  childrenCollapsed?: boolean;
}

// --- API response shapes ---

export interface AlgoliaHit {
  objectID: string;
  title: string;
  url?: string;
  points: number;
  author: string;
  created_at_i: number;
  num_comments: number;
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
}

// --- Cache types ---

export interface CachedStory {
  story: Story;
  comments: Comment[];
  timestamp: number;
  isFresh: boolean;
  orderedDepth: number;
}

export interface CachedStories {
  stories: Story[];
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
  story: Story;
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
  from?: StoryType;
}

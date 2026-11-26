import {
  useAlgoliaInfiniteStories,
  type AlgoliaStoriesCache,
  type AlgoliaStoriesSource,
} from './useAlgoliaInfiniteStories';

const userStoriesCache: AlgoliaStoriesCache = new Map();

/**
 * @internal Testing helper to reset the module-level cache between tests.
 */
export function __resetUserStoriesCacheForTests() {
  userStoriesCache.clear();
}

/** @internal Exposes cache for test assertions. */
export function __getUserStoriesCacheForTests() {
  return userStoriesCache;
}

/** Centralized empty-state title for user submission pages. */
export function formatNoUserSubmissionsTitle(username: string): string {
  return `No submissions found by "${username}"`;
}

const userSource: AlgoliaStoriesSource = {
  cache: userStoriesCache,
  // tags=(story,poll),author_X: stories or polls (an OR group) AND
  // authored by X, as HN's /submitted lists both. search_by_date returns
  // chronological newest-first, matching HN's /submitted ordering.
  query: (username) => `tags=(story,poll),author_${encodeURIComponent(username)}`,
};

/**
 * Paginated user stories from Algolia (`author_X` tag, exact match).
 * No local filter needed — every hit belongs to the user.
 * Remount (React `key`) to change user.
 */
export function useUserInfiniteStories(username: string) {
  return useAlgoliaInfiniteStories(username, userSource);
}

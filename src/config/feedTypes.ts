/** Every feed, in nav order. 'top' is the homepage and has no nav tab. */
export const FEED_TYPES = ['top', 'best', 'show', 'ask', 'newest'] as const;
export type FeedType = (typeof FEED_TYPES)[number];

// 'top' is intentionally omitted — the homepage title is just "HackerTok".
export const FEED_TYPE_TITLES: Partial<Record<FeedType, string>> = {
  best: 'Best',
  ask: 'Ask',
  show: 'Show',
  newest: 'New',
};

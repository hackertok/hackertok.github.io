import type { FeedType } from '../types';

// 'top' is intentionally omitted — the homepage title is just "HackerTok".
export const FEED_TYPE_TITLES: Partial<Record<FeedType, string>> = {
  best: 'Best',
  ask: 'Ask',
  show: 'Show',
};

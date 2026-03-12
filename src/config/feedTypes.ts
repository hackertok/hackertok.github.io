/**
 * Item type configuration
 * Maps item types to display titles for document title and UI
 * 
 * Note: 'top' is omitted - homepage uses just "HackerTok"
 */

import type { FeedType } from '../types';

export const FEED_TYPE_TITLES: Partial<Record<FeedType, string>> = {
  best: 'Best',
  ask: 'Ask',
  show: 'Show',
};

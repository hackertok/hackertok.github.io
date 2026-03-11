/**
 * Story type configuration
 * Maps story types to display titles for document title and UI
 * 
 * Note: 'top' is omitted - homepage uses just "HackerTok"
 */

import type { StoryType } from '../types';

export const STORY_TYPE_TITLES: Partial<Record<StoryType, string>> = {
  best: 'Best Stories',
  ask: 'Ask HN',
  show: 'Show HN',
};

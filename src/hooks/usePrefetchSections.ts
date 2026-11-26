import { useEffect, useRef } from 'react';
import { fetchTopStories, fetchBestStories, fetchNewStories, fetchShowStories, fetchAskStories, prefetchItemComments } from '../api/hn';
import { getCachedFeed, setCachedFeed } from '../utils/feedCache';
import { setCachedItem, getCachedItem } from '../utils/itemCache';
import { waitForPriorityFetch } from '../utils/fetchPriority';
import { getFilteredViewedIds, getSessionViewedIds } from '../utils/viewedItems';
import { FEED_TYPES } from '../config/feedTypes';
import type { StoryItem, FeedType } from '../types';

function getCachedStoriesIfFresh(type: FeedType): StoryItem[] | null {
  const cached = getCachedFeed(type);
  return cached && !cached.isStale ? cached.stories : null;
}

// The story a feed opens on: the swipe viewer skips stories viewed in an
// earlier session (see SwipeStoryViewerCore's mergedStories).
function firstShownStory(stories: StoryItem[]): StoryItem | undefined {
  const hidden = getFilteredViewedIds();
  const session = getSessionViewedIds();
  return stories.find(s => session.has(s.id) || !hidden.has(s.id)) ?? stories[0];
}

// A stale thread still shows at once and refreshes when opened, so only a
// missing one is worth downloading ahead.
function needsThread(stories: StoryItem[]): boolean {
  const first = firstShownStory(stories);
  return !!first && !getCachedItem(first.id)?.comments;
}

async function fetchFirstPage(type: FeedType): Promise<StoryItem[]> {
  switch (type) {
    case 'top': {
      const stories = await fetchTopStories(20);
      return stories;
    }
    case 'best': {
      const result = await fetchBestStories(0, 30);
      return result.stories;
    }
    case 'show': {
      const result = await fetchShowStories(0);
      return result.stories;
    }
    case 'ask': {
      const result = await fetchAskStories(0);
      return result.stories;
    }
    case 'newest': {
      const result = await fetchNewStories(0, 30);
      return result.stories;
    }
    default:
      return [];
  }
}

/**
 * Background prefetch for other feed sections. `ready` holds it until the
 * current feed is on screen, so its first story has claimed priority.
 */
export function usePrefetchSections(currentType: FeedType, ready = true) {
  const hasPrefetchedRef = useRef(false);

  useEffect(() => {
    if (!ready || hasPrefetchedRef.current) return;

    const sectionsNeedingWork = FEED_TYPES.filter(type => {
      if (type === currentType) return false;
      const stories = getCachedStoriesIfFresh(type);
      return !stories || needsThread(stories);
    });

    if (sectionsNeedingWork.length === 0) {
      hasPrefetchedRef.current = true;
      return;
    }

    let cancelled = false;

    async function fetchList(type: FeedType): Promise<StoryItem[]> {
      try {
        const stories = await fetchFirstPage(type);
        if (!cancelled && stories.length > 0) setCachedFeed(type, stories);
        return stories;
      } catch (err) {
        console.debug(`Prefetch failed for ${type}:`, (err as Error).message);
        return [];
      }
    }

    async function prefetchThread(stories: StoryItem[]) {
      if (cancelled || !needsThread(stories)) return;
      const { id } = firstShownStory(stories)!;
      const result = await prefetchItemComments(id);
      // Kept after a switch cancels the rest, unless the story, opened
      // meanwhile, cached a newer copy.
      if (result && !getCachedItem(id)?.comments) setCachedItem(id, result.item, result.comments);
    }

    async function prefetchAll() {
      // Wait for the current item's comments first so it gets full bandwidth.
      try {
        await waitForPriorityFetch();
      } catch {
        return;
      }
      if (cancelled) return;

      // Lists are small: fetched together, so every tab is fresh early.
      // Threads can be large: one at a time, as their lists arrive.
      let threads = Promise.resolve();
      await Promise.all(sectionsNeedingWork.map(async type => {
        const stories = getCachedStoriesIfFresh(type) ?? await fetchList(type);
        threads = threads.then(() => prefetchThread(stories));
      }));
      await threads;

      if (!cancelled) {
        hasPrefetchedRef.current = true;
      }
    }

    // Delay so the current section's fetches don't race with prefetching.
    const timeoutId = setTimeout(() => void prefetchAll(), 1000);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [currentType, ready]);
}

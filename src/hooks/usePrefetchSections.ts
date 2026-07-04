import { useEffect, useRef } from 'react';
import { fetchTopStories, fetchBestStories, fetchNewStories, fetchShowStories, fetchAskStories, prefetchItemComments } from '../api/hn';
import { getCachedFeed, setCachedFeed } from '../utils/feedCache';
import { setCachedItem, getCachedItem } from '../utils/itemCache';
import { waitForPriorityFetch } from '../utils/fetchPriority';
import type { StoryItem, FeedType } from '../types';

const ALL_SECTIONS: FeedType[] = ['top', 'best', 'show', 'ask', 'newest'];
const STAGGER_DELAY = 500; // ms between requests to be API-friendly
const CACHE_FRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes

function getCachedStoriesIfFresh(type: FeedType): StoryItem[] | null {
  const cached = getCachedFeed(type);
  if (!cached) return null;
  const age = Date.now() - cached.timestamp;
  if (age >= CACHE_FRESH_THRESHOLD) return null;
  return cached.stories;
}

function isFirstStoryCommentsCached(stories: StoryItem[]): boolean {
  if (!stories || stories.length === 0) return true; // Nothing to prefetch
  const firstStory = stories[0];
  if (!firstStory?.id) return true;
  const cached = getCachedItem(firstStory.id);
  return !!(cached?.isFresh && cached?.comments);
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

/** Background prefetch for other feed sections. */
export function usePrefetchSections(currentType: FeedType) {
  const hasPrefetchedRef = useRef(false);
  const currentTypeRef = useRef(currentType);
  
  // Track current type so the loop below can skip it if the user switches mid-flight.
  useEffect(() => {
    currentTypeRef.current = currentType;
  }, [currentType]);
  
  useEffect(() => {
    if (hasPrefetchedRef.current) return;
    
    const sectionsToFetch = ALL_SECTIONS.filter(type => type !== currentType);
    
    // A section needs work if its story list ISN'T fresh OR its first
    // story's comments aren't cached.
    const sectionsNeedingWork = sectionsToFetch.filter(type => {
      const cachedStories = getCachedStoriesIfFresh(type);
      return !cachedStories || !isFirstStoryCommentsCached(cachedStories);
    });
    
    if (sectionsNeedingWork.length === 0) {
      hasPrefetchedRef.current = true;
      return;
    }
    
    let cancelled = false;
    
    async function prefetchAll() {
      // Wait for the current item's comments first so it gets full bandwidth.
      try {
        await waitForPriorityFetch();
      } catch {
        // Aborted - stop prefetching
        return;
      }
      
      if (cancelled) return;
      
      for (let i = 0; i < sectionsNeedingWork.length; i++) {
        if (cancelled) break;
        
        const type = sectionsNeedingWork[i];
        
        // User may have switched while we were waiting — skip the now-current section.
        if (type === currentTypeRef.current) continue;
        
        try {
          let stories = getCachedStoriesIfFresh(type);
          
          if (!stories) {
            stories = await fetchFirstPage(type);
            
            if (cancelled) break;
            
            if (stories.length > 0 && type !== currentTypeRef.current) {
              setCachedFeed(type, stories);
            }
          }
          
          if (cancelled) break;
          
          // Prefetch first story's comments even when the list itself was cached —
          // a stale comments cache for the visible-on-arrival story would defeat
          // the warm-up.
          if (stories.length > 0 && type !== currentTypeRef.current) {
            const firstStory = stories[0];
            if (firstStory?.id) {
              const cachedComments = getCachedItem(firstStory.id);
              if (!cachedComments?.isFresh || !cachedComments?.comments) {
                try {
                  const result = await prefetchItemComments(firstStory.id, undefined, 1);
                  if (result && !cancelled && type !== currentTypeRef.current) {
                    setCachedItem(firstStory.id, result.item, result.comments, 1);
                  }
                } catch { /* best-effort */ }
              }
            }
          }
        } catch (err) {
          console.debug(`Prefetch failed for ${type}:`, (err as Error).message);
        }
        
        if (i < sectionsNeedingWork.length - 1 && !cancelled) {
          await new Promise(resolve => setTimeout(resolve, STAGGER_DELAY));
        }
      }
      
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
  }, [currentType]);
}

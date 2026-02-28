import { useEffect, useRef } from 'react';
import { fetchTopStoriesAlgolia, fetchBestStories, fetchShowStories, fetchAskStories, prefetchStoryComments } from '../api/hn';
import { getCachedStories, setCachedStories } from '../utils/storiesCache';
import { setCachedStory, getCachedStory } from '../utils/storyCache';
import { waitForPriorityFetch } from '../utils/fetchPriority';

const ALL_SECTIONS = ['top', 'best', 'show', 'ask'];
const STAGGER_DELAY = 500; // ms between requests to be API-friendly
const CACHE_FRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes - match storiesCache.js

/**
 * Get cached stories for a section (or null if not cached/stale)
 */
function getCachedStoriesIfFresh(type) {
  const cached = getCachedStories(type);
  if (!cached) return null;
  const age = Date.now() - cached.timestamp;
  if (age >= CACHE_FRESH_THRESHOLD) return null;
  return cached.stories;
}

/**
 * Check if the first story's comments are cached and fresh
 */
function isFirstStoryCommentsCached(stories) {
  if (!stories || stories.length === 0) return true; // Nothing to prefetch
  const firstStory = stories[0];
  if (!firstStory?.id) return true;
  const cached = getCachedStory(firstStory.id);
  return cached?.isFresh && cached?.comments;
}

/**
 * Fetch first page of stories for a section
 */
async function fetchFirstPage(type) {
  switch (type) {
    case 'top': {
      const stories = await fetchTopStoriesAlgolia(20);
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
    default:
      return [];
  }
}

/**
 * Prefetch first page of stories for sections other than the current one.
 * Runs in background after current section loads, with staggered requests.
 * Uses existing storiesCache so useInfiniteStories picks up cached data on mount.
 * 
 * @param {string} currentType - Current section type ('top' | 'best' | 'show' | 'ask')
 */
export function usePrefetchSections(currentType) {
  const hasPrefetchedRef = useRef(false);
  const currentTypeRef = useRef(currentType);
  
  // Track current type to avoid prefetching it
  useEffect(() => {
    currentTypeRef.current = currentType;
  }, [currentType]);
  
  useEffect(() => {
    if (hasPrefetchedRef.current) return;
    
    // Determine which sections to prefetch (all except current)
    const sectionsToFetch = ALL_SECTIONS.filter(type => type !== currentType);
    
    // Check which sections need work (either story list fetch OR first story comments prefetch)
    const sectionsNeedingWork = sectionsToFetch.filter(type => {
      const cachedStories = getCachedStoriesIfFresh(type);
      // Need work if: no story list cache OR first story comments not cached
      return !cachedStories || !isFirstStoryCommentsCached(cachedStories);
    });
    
    if (sectionsNeedingWork.length === 0) {
      hasPrefetchedRef.current = true;
      return;
    }
    
    let cancelled = false;
    
    async function prefetchAll() {
      // Wait for user-visible content (current story comments) to load first
      // This ensures the current story gets full network bandwidth
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
        
        // Skip if this is now the current section (user switched)
        if (type === currentTypeRef.current) continue;
        
        try {
          // Check if we have cached stories or need to fetch
          let stories = getCachedStoriesIfFresh(type);
          
          if (!stories) {
            // Need to fetch story list
            stories = await fetchFirstPage(type);
            
            if (cancelled) break;
            
            // Cache the stories list
            if (stories.length > 0 && type !== currentTypeRef.current) {
              setCachedStories(type, stories);
            }
          }
          
          if (cancelled) break;
          
          // Prefetch first story's comments (even if list was cached)
          if (stories.length > 0 && type !== currentTypeRef.current) {
            const firstStory = stories[0];
            if (firstStory?.id) {
              // Check if comments already cached
              const cachedComments = getCachedStory(firstStory.id);
              if (!cachedComments?.isFresh || !cachedComments?.comments) {
                try {
                  const result = await prefetchStoryComments(firstStory.id, null, 1);
                  if (result && !cancelled && type !== currentTypeRef.current) {
                    setCachedStory(firstStory.id, result.story, result.comments, 1);
                  }
                } catch {
                  // Silently fail - comments prefetch is best-effort
                }
              }
            }
          }
        } catch (err) {
          // Silently fail - prefetch is best-effort
          console.debug(`Prefetch failed for ${type}:`, err.message);
        }
        
        // Stagger requests (but not after the last one)
        if (i < sectionsNeedingWork.length - 1 && !cancelled) {
          await new Promise(resolve => setTimeout(resolve, STAGGER_DELAY));
        }
      }
      
      if (!cancelled) {
        hasPrefetchedRef.current = true;
      }
    }
    
    // Start prefetching after a short delay to let current section load first
    const timeoutId = setTimeout(prefetchAll, 1000);
    
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [currentType]);
}

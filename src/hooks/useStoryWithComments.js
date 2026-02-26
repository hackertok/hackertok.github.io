import { useState, useEffect, useCallback } from 'react';
import { fetchStoryOnly, fetchCommentsForStory } from '../api/hn';
import { getCachedStory, setCachedStory } from '../utils/storyCache';
import { registerPriorityFetch, unregisterPriorityFetch } from '../utils/fetchPriority';

/**
 * Hook to fetch story and comments
 * @param {number|string} storyId - Story ID to fetch
 * @param {object} options - Hook options
 * @param {object} options.initialStory - Optional pre-loaded story data (avoids redundant fetch)
 * @param {boolean} options.skipOrderingCompletion - Skip background re-fetch for deep ordering (mobile swipe mode)
 */
export function useStoryWithComments(storyId, { initialStory = null, skipOrderingCompletion = false } = {}) {
  // Check cache at initialization time (runs once per mount)
  const initialCache = getCachedStory(storyId);
  
  // Lazy initialization from cache or initialStory for instant render
  const [story, setStory] = useState(() => initialStory || initialCache?.story || null);
  const [comments, setComments] = useState(() => initialCache?.comments || null);
  
  // If we have initialStory, don't show story loading state
  const [storyLoading, setStoryLoading] = useState(!initialStory && !initialCache?.story);
  const [commentsLoading, setCommentsLoading] = useState(!initialCache?.comments);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cached = getCachedStory(storyId);
    
    // We have story from either initialStory prop or cache
    const hasStory = initialStory || cached?.story;
    
    // Determine if we need to fetch: either no cache, stale cache, or partial ordering
    const needsFullFetch = !cached?.isFresh || !hasStory || !cached?.comments;
    // Skip ordering completion in mobile swipe mode (users swipe fast, deep order doesn't matter)
    const needsOrderingCompletion = !skipOrderingCompletion && cached?.isFresh && cached?.orderedDepth < 3;
    
    // If cache is fresh AND fully ordered, skip fetch entirely
    if (cached?.isFresh && hasStory && cached?.comments && cached?.orderedDepth >= 3) {
      return;
    }
    
    let cancelled = false;

    async function loadStory() {
      // If we have initialStory, use it directly - no fetch needed
      if (initialStory) {
        return initialStory;
      }
      
      // Only set loading if we don't have cached story
      if (!cached?.story) {
        setStoryLoading(true);
      }
      
      try {
        const storyData = await fetchStoryOnly(storyId);
        if (!cancelled) {
          setStory(storyData);
          setStoryLoading(false);
        }
        return storyData;
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setStoryLoading(false);
          setCommentsLoading(false);
        }
        return null;
      }
    }

    async function loadComments(storyData, isBackgroundReorder = false) {
      // Only set loading if we don't have cached comments AND not a background reorder
      const isPriorityFetch = !cached?.comments && !isBackgroundReorder;
      if (isPriorityFetch) {
        setCommentsLoading(true);
        // Signal that user-visible content is loading - prefetchers should wait
        registerPriorityFetch();
      }
      
      try {
        // Fetch with full ordering (default maxDepth=3)
        const commentsData = await fetchCommentsForStory(storyId);
        if (!cancelled) {
          setComments(commentsData);
          setCommentsLoading(false);
          
          // Cache the complete story with comments and full ordering
          if (storyData) {
            setCachedStory(storyId, storyData, commentsData, 3);
          }
        }
      } catch (err) {
        if (!cancelled) {
          // Comments failed but story succeeded - still usable
          setCommentsLoading(false);
          console.warn('Failed to load comments:', err);
        }
      } finally {
        // Release priority regardless of success/failure
        if (isPriorityFetch) {
          unregisterPriorityFetch();
        }
      }
    }

    async function load() {
      setError(null);
      
      if (needsOrderingCompletion && hasStory) {
        // We have cached/initial data with partial ordering - show it immediately
        // and fetch fully ordered comments in the background
        await loadComments(initialStory || cached.story, true);
      } else if (needsFullFetch) {
        // Need to fetch story and/or comments
        const storyData = hasStory ? (initialStory || cached?.story) : await loadStory();
        
        // Then load comments
        if (storyData && !cancelled) {
          await loadComments(storyData, false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [storyId, initialStory, skipOrderingCompletion]);

  // Combined loading state for backward compatibility
  const loading = storyLoading && commentsLoading;

  // Refresh function for pull-to-refresh
  const refresh = useCallback(async () => {
    setError(null);
    
    try {
      const storyData = await fetchStoryOnly(storyId);
      setStory(storyData);
      
      const commentsData = await fetchCommentsForStory(storyId);
      setComments(commentsData);
      
      // Update cache
      setCachedStory(storyId, storyData, commentsData);
    } catch (err) {
      setError(err.message);
    }
  }, [storyId]);

  return { 
    story, 
    comments,
    loading,
    storyLoading,
    commentsLoading,
    error,
    refresh
  };
}

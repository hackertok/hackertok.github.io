import { useState, useEffect, useCallback } from 'react';
import { fetchStoryOnly, fetchCommentsForStory } from '../api/hn';
import { getCachedStory, setCachedStory } from '../utils/storyCache';

export function useStoryWithComments(storyId) {
  // Check cache at initialization time (runs once per mount)
  const initialCache = getCachedStory(storyId);
  
  // Lazy initialization from cache for instant render
  const [story, setStory] = useState(() => initialCache?.story || null);
  const [comments, setComments] = useState(() => initialCache?.comments || null);
  
  const [storyLoading, setStoryLoading] = useState(!initialCache?.story);
  const [commentsLoading, setCommentsLoading] = useState(!initialCache?.comments);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cached = getCachedStory(storyId);
    
    // Determine if we need to fetch: either no cache, stale cache, or partial ordering
    const needsFullFetch = !cached?.isFresh || !cached?.story || !cached?.comments;
    const needsOrderingCompletion = cached?.isFresh && cached?.orderedDepth < 3;
    
    // If cache is fresh AND fully ordered, skip fetch entirely
    if (cached?.isFresh && cached?.story && cached?.comments && cached?.orderedDepth >= 3) {
      return;
    }
    
    let cancelled = false;

    async function loadStory() {
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
      if (!cached?.comments && !isBackgroundReorder) {
        setCommentsLoading(true);
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
      }
    }

    async function load() {
      setError(null);
      
      if (needsOrderingCompletion && cached?.story) {
        // We have cached data with partial ordering - show it immediately
        // and fetch fully ordered comments in the background
        await loadComments(cached.story, true);
      } else if (needsFullFetch) {
        // Need to fetch story and/or comments
        const storyData = cached?.story || await loadStory();
        
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
  }, [storyId]);

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

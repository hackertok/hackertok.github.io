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
    // Skip fetch if cache is fresh (data already loaded via lazy init)
    const cached = getCachedStory(storyId);
    if (cached?.isFresh && cached.story && cached.comments) {
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

    async function loadComments(storyData) {
      // Only set loading if we don't have cached comments
      if (!cached?.comments) {
        setCommentsLoading(true);
      }
      
      try {
        const commentsData = await fetchCommentsForStory(storyId);
        if (!cancelled) {
          setComments(commentsData);
          setCommentsLoading(false);
          
          // Cache the complete story with comments
          if (storyData) {
            setCachedStory(storyId, storyData, commentsData);
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
      
      // Load story first for progressive render
      const storyData = await loadStory();
      
      // Then load comments
      if (storyData && !cancelled) {
        await loadComments(storyData);
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

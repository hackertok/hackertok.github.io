import { useState, useEffect, useEffectEvent, useCallback } from 'react';
import { fetchStoryOnly, fetchCommentsForStory } from '../api/hn';
import { getCachedStory, setCachedStory } from '../utils/storyCache';
import { registerPriorityFetch, unregisterPriorityFetch } from '../utils/fetchPriority';

/**
 * Hook to fetch story and comments
 * @param {number|string} storyId - Story ID to fetch
 * @param {object} options - Hook options
 * @param {object} options.initialStory - Optional pre-loaded story data (avoids redundant fetch)
 * @param {boolean} options.skipOrderingCompletion - Skip background re-fetch for deep ordering (mobile swipe mode)
 * @param {boolean} options.isPriority - If true, fetch immediately; if false, wait for priority fetches to complete first (mobile serialization)
 * @param {boolean} options.deferComments - If true, skip comment fetch entirely (for far panels in mobile swipe view)
 */
export function useStoryWithComments(storyId, { initialStory = null, skipOrderingCompletion = false, isPriority = true, deferComments = false } = {}) {
  // Check cache at initialization time (runs once per mount)
  const initialCache = getCachedStory(storyId);
  
  // Lazy initialization from cache or initialStory for instant render
  const [story, setStory] = useState(() => initialStory || initialCache?.story || null);
  const [comments, setComments] = useState(() => initialCache?.comments || null);
  
  // If we have initialStory, don't show story loading state
  const [storyLoading, setStoryLoading] = useState(!initialStory && !initialCache?.story);
  const [commentsLoading, setCommentsLoading] = useState(!initialCache?.comments);
  const [error, setError] = useState(null);

  // Effect Events: read values without triggering effect re-run
  // These allow reading current props/state in effects and cleanup without adding them as dependencies
  
  // Read non-reactive options (configuration that shouldn't cause re-sync)
  const getStableOptions = useEffectEvent(() => ({
    isPriority,
    initialStory,
    skipOrderingCompletion
  }));

  // Read current state for comparisons (without reacting to state changes)
  const getStateSnapshot = useEffectEvent(() => ({
    currentStoryId: story?.id,
    hasComments: !!comments,
    currentStory: story
  }));

  // Cleanup decision logic (needs current storyId and deferComments)
  const shouldSkipAbort = useEffectEvent((effectStoryId) => {
    // Check if storyId changed (effectStoryId is OLD, storyId is current)
    const isStoryIdChanging = effectStoryId !== storyId;
    // Only skip abort if:
    // 1. storyId is NOT changing (same story)
    // 2. AND deferComments is transitioning TO true (becoming deferred)
    // This lets the fetch complete in the background - it will unregister itself
    return !isStoryIdChanging && deferComments;
  });
  
  useEffect(() => {
    // Read stable options via Effect Event (won't cause re-sync when they change)
    const { isPriority, initialStory, skipOrderingCompletion } = getStableOptions();
    // Read current state snapshot for comparisons
    const { currentStoryId, hasComments, currentStory } = getStateSnapshot();
    
    // Capture storyId for this effect instance (to detect storyId changes in cleanup)
    const effectStoryId = storyId;
    // Deferred panels: skip comment fetch entirely (story already initialized via useState)
    if (deferComments) {
      return;
    }
    
    const cached = getCachedStory(storyId);
    
    // We have story from either initialStory prop or cache
    const hasStory = initialStory || cached?.story;
    
    // Check if state has a different story's data (storyId changed)
    const stateHasDifferentStory = currentStory && String(currentStoryId) !== String(storyId);
    
    // If cache has comments that we don't have in state yet, OR if storyId changed, sync from cache
    // This handles: 1) prefetch populated cache after mount, 2) navigation to cached story
    if (cached?.isFresh && cached?.comments && (!hasComments || stateHasDifferentStory)) {
      setComments(cached.comments);
      setCommentsLoading(false);
      // Sync story too if needed
      if (cached.story && (!currentStory || stateHasDifferentStory)) {
        setStory(cached.story);
        setStoryLoading(false);
      }
    } else if (stateHasDifferentStory) {
      // storyId changed but new story is NOT in cache (or cache is stale)
      // Reset state to loading to prevent showing wrong story's content
      // Use initialStory if provided AND it matches the new storyId
      const validInitialStory = initialStory && String(initialStory.id) === String(storyId) 
        ? initialStory 
        : null;
      setStory(validInitialStory);
      setStoryLoading(!validInitialStory);
      setComments(null);
      setCommentsLoading(true);
    }
    
    // Determine if we need to fetch: either no cache, stale cache, or partial ordering
    const needsFullFetch = !cached?.isFresh || !hasStory || !cached?.comments;
    // Skip ordering completion in mobile swipe mode (users swipe fast, deep order doesn't matter)
    const needsOrderingCompletion = !skipOrderingCompletion && cached?.isFresh && cached?.orderedDepth < 3;
    
    // If cache is fresh AND fully ordered, skip fetch entirely
    if (cached?.isFresh && hasStory && cached?.comments && cached?.orderedDepth >= 3) {
      return;
    }
    
    // Track if we registered priority (for cleanup)
    let didRegister = false;
    const controller = new AbortController();
    
    // SYNC: Priority panels register immediately (before any async work)
    // This ensures non-priority panels will wait even if their effect runs first
    if (isPriority && needsFullFetch && !cached?.comments) {
      registerPriorityFetch();
      didRegister = true;
    }

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
        if (!controller.signal.aborted) {
          setStory(storyData);
          setStoryLoading(false);
        }
        return storyData;
      } catch (err) {
        if (!controller.signal.aborted && err.name !== 'AbortError') {
          setError(err.message);
          setStoryLoading(false);
          setCommentsLoading(false);
          
          // Unregister priority on story fetch failure so prefetchers aren't blocked
          if (didRegister) {
            unregisterPriorityFetch();
            didRegister = false;
          }
        }
        return null;
      }
    }

    async function loadComments(storyData, isBackgroundReorder = false) {
      // Check abort before expensive fetch
      if (controller.signal.aborted) return;
      
      // Only set loading if we don't have cached comments AND not a background reorder
      const shouldSetLoading = !cached?.comments && !isBackgroundReorder;
      if (shouldSetLoading) {
        setCommentsLoading(true);
      }
      
      try {
        // Fetch with full ordering (default maxDepth=3)
        const commentsData = await fetchCommentsForStory(storyId, 3, controller.signal);
        if (!controller.signal.aborted) {
          setComments(commentsData);
          setCommentsLoading(false);
          
          // Cache the complete story with comments and full ordering
          if (storyData) {
            setCachedStory(storyId, storyData, commentsData, 3);
          }
          
          // Unregister priority now that comments are loaded
          // This allows section prefetch and other lower-priority fetches to proceed
          if (didRegister) {
            unregisterPriorityFetch();
            didRegister = false;
          }
        }
      } catch (err) {
        if (!controller.signal.aborted && err.name !== 'AbortError') {
          // Comments failed but story succeeded - still usable
          setCommentsLoading(false);
          console.warn('Failed to load comments:', err);
          
          // Unregister priority even on failure so prefetchers aren't blocked forever
          if (didRegister) {
            unregisterPriorityFetch();
            didRegister = false;
          }
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
        if (storyData && !controller.signal.aborted) {
          await loadComments(storyData, false);
        }
      }
    }

    load();

    return () => {
      // Use Effect Event for cleanup decision (reads current storyId and deferComments)
      if (shouldSkipAbort(effectStoryId)) {
        return;
      }
      
      // Cleanup due to storyId change, unmount, or becoming non-deferred - abort the fetch
      controller.abort();
      if (didRegister) {
        unregisterPriorityFetch();
      }
    };
  }, [storyId, deferComments]); // All other values read via Effect Events

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

import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchTopStoriesAlgolia, fetchFrontPageForDay, fetchBestStories } from '../api/hn';
import { getCachedStories, setCachedStories } from '../utils/storiesCache';
import { getListSessionState, saveListSessionState, clearListSessionState } from '../utils/storyCache';

// Initialize state from session (instant back) or cache (persistent)
function getInitialState(type) {
  // First check session state for instant back navigation
  const sessionState = getListSessionState(type);
  if (sessionState && sessionState.storyIds.length > 0) {
    // We have session state - reconstruct stories from LocalStorage cache
    const cached = getCachedStories(type);
    if (cached && cached.stories.length > 0) {
      // Create a map for fast lookup
      const storyMap = new Map(cached.stories.map(s => [s.id, s]));
      // Reconstruct stories in session order
      const stories = sessionState.storyIds
        .map(id => storyMap.get(id))
        .filter(Boolean);
      
      // Only use session state if we could reconstruct most stories
      if (stories.length >= sessionState.storyIds.length * 0.8) {
        return {
          stories,
          isFromCache: false, // Don't revalidate - we're coming back
          isFromSession: true,
          sessionState, // Pass along for scroll restoration
        };
      }
    }
  }
  
  // Fall back to cache
  const cached = getCachedStories(type);
  if (cached && cached.stories.length > 0) {
    return {
      stories: cached.stories,
      isFromCache: true,
      isFromSession: false,
      sessionState: null,
    };
  }
  return {
    stories: [],
    isFromCache: false,
    isFromSession: false,
    sessionState: null,
  };
}

export function useInfiniteStories(type = 'top') {
  // Lazy initialization: sync read from localStorage on first render (called once)
  const [initialState] = useState(() => getInitialState(type));
  const [stories, setStories] = useState(initialState.stories);
  const [isFromCache, setIsFromCache] = useState(initialState.isFromCache);
  const [isFromSession] = useState(initialState.isFromSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(
    initialState.sessionState?.hasMore ?? true
  );
  
  // For top: 0 = current front page (Firebase), 1+ = days ago (Algolia)
  // For best: tracks offset into the list
  const positionRef = useRef(
    initialState.sessionState?.position ?? 0
  );
  const seenIdsRef = useRef(
    initialState.sessionState?.seenIds ?? new Set()
  );
  // Version counter to cancel stale responses
  const versionRef = useRef(0);
  // Track if we have cached data that needs revalidation (start true if we loaded from cache)
  const hasStaleCacheRef = useRef(initialState.isFromCache);
  
  // Expose scroll position from session for StoryList to use
  const initialScrollY = initialState.sessionState?.scrollY ?? 0;

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;

    setLoading(true);
    setError(null);
    
    // Capture current version to check if response is stale
    const currentVersion = versionRef.current;

    try {
      if (type === 'top') {
        let newStories = [];
        const isRevalidating = hasStaleCacheRef.current && positionRef.current === 0;
        
        if (positionRef.current === 0) {
          // First load: fetch current front page from Algolia (single fast request)
          const frontPage = await fetchTopStoriesAlgolia(20);
          
          // Check if we've been reset during the fetch
          if (versionRef.current !== currentVersion) return;
          
          // For revalidation, we replace all stories, so don't filter by seenIds
          if (isRevalidating) {
            seenIdsRef.current.clear();
          }
          
          newStories = frontPage.filter(story => {
            if (seenIdsRef.current.has(story.id)) {
              return false;
            }
            seenIdsRef.current.add(story.id);
            return true;
          });
          
          // Cache fresh stories (only first page)
          if (newStories.length > 0) {
            setCachedStories(type, newStories);
            setIsFromCache(false);
            hasStaleCacheRef.current = false;
          }
          
          positionRef.current = 1; // Next load will be yesterday
        } else {
          // Subsequent loads: day-based pagination using Algolia
          let attempts = 0;
          const maxAttempts = 5; // Try up to 5 days if current day has no stories

          while (newStories.length === 0 && attempts < maxAttempts && positionRef.current < 365) {
            const dayStories = await fetchFrontPageForDay(positionRef.current);
            
            // Check if we've been reset during the fetch
            if (versionRef.current !== currentVersion) return;
            
            // Filter out duplicates
            const uniqueStories = dayStories.filter(story => {
              if (seenIdsRef.current.has(story.id)) {
                return false;
              }
              seenIdsRef.current.add(story.id);
              return true;
            });

            newStories = uniqueStories;
            positionRef.current += 1;
            attempts += 1;
          }
        }

        // Final staleness check before updating state
        if (versionRef.current !== currentVersion) return;

        if (newStories.length === 0 && positionRef.current >= 365) {
          setHasMore(false);
        } else if (newStories.length > 0) {
          // If revalidating, replace stories instead of appending
          if (isRevalidating) {
            setStories(newStories);
          } else {
            setStories(prev => [...prev, ...newStories]);
          }
        }
      } else {
        // Best stories: offset-based pagination using Firebase
        const isRevalidatingBest = hasStaleCacheRef.current && positionRef.current === 0;
        const result = await fetchBestStories(positionRef.current, 30);
        
        // Check if we've been reset during the fetch
        if (versionRef.current !== currentVersion) return;
        
        // For revalidation, we replace all stories, so don't filter by seenIds
        if (isRevalidatingBest) {
          seenIdsRef.current.clear();
        }
        
        // Filter out duplicates
        const uniqueStories = result.stories.filter(story => {
          if (seenIdsRef.current.has(story.id)) {
            return false;
          }
          seenIdsRef.current.add(story.id);
          return true;
        });

        // Cache first page of best stories
        if (positionRef.current === 0 && uniqueStories.length > 0) {
          setCachedStories(type, uniqueStories);
          setIsFromCache(false);
          hasStaleCacheRef.current = false;
        }

        positionRef.current = result.nextOffset;
        setHasMore(result.hasMore);
        
        if (uniqueStories.length > 0) {
          // If revalidating, replace stories instead of appending
          if (isRevalidatingBest) {
            setStories(uniqueStories);
          } else {
            setStories(prev => [...prev, ...uniqueStories]);
          }
        }
      }
    } catch (err) {
      // Only set error if not stale
      if (versionRef.current === currentVersion) {
        setError(err.message);
      }
    } finally {
      // Only clear loading if not stale
      if (versionRef.current === currentVersion) {
        setLoading(false);
      }
    }
  }, [loading, hasMore, type]);

  const reset = useCallback(() => {
    // Increment version to invalidate any in-flight requests
    versionRef.current += 1;
    
    // Re-initialize from cache for the current type
    const initial = getInitialState(type);
    setStories(initial.stories);
    setIsFromCache(initial.isFromCache);
    hasStaleCacheRef.current = initial.isFromCache;
    
    setLoading(false);
    setError(null);
    setHasMore(true);
    positionRef.current = 0;
    seenIdsRef.current.clear();
    // Clear session state when explicitly reset
    clearListSessionState(type);
  }, [type]);

  // Save session state for instant back navigation
  const saveSessionState = useCallback((scrollY = window.scrollY) => {
    if (stories.length === 0) return;
    
    saveListSessionState(type, {
      scrollY,
      storyIds: stories.map(s => s.id),
      position: positionRef.current,
      seenIds: seenIdsRef.current,
      hasMore,
    });
    
    // Also update the stories cache with current full list (for session reconstruction)
    if (stories.length > 0) {
      setCachedStories(type, stories);
    }
  }, [type, stories, hasMore]);

  return { 
    stories, 
    loading, 
    error, 
    hasMore, 
    loadMore, 
    reset, 
    isFromCache, 
    isFromSession,
    initialScrollY,
    saveSessionState,
  };
}

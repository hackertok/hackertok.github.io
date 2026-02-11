import { useState, useCallback, useRef } from 'react';
import { fetchCurrentTopStories, fetchFrontPageForDay, fetchBestStories } from '../api/hn';
import { getCachedStories, setCachedStories } from '../utils/storiesCache';

// Initialize state from cache synchronously on first render
function getInitialState(type) {
  const cached = getCachedStories(type);
  if (cached && cached.stories.length > 0) {
    return {
      stories: cached.stories,
      isFromCache: true,
    };
  }
  return {
    stories: [],
    isFromCache: false,
  };
}

export function useInfiniteStories(type = 'top') {
  // Lazy initialization: sync read from localStorage on first render (called once)
  const [initialState] = useState(() => getInitialState(type));
  const [stories, setStories] = useState(initialState.stories);
  const [isFromCache, setIsFromCache] = useState(initialState.isFromCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  
  // For top: 0 = current front page (Firebase), 1+ = days ago (Algolia)
  // For best: tracks offset into the list
  const positionRef = useRef(0);
  const seenIdsRef = useRef(new Set());
  // Version counter to cancel stale responses
  const versionRef = useRef(0);
  // Track if we have cached data that needs revalidation (start true if we loaded from cache)
  const hasStaleCacheRef = useRef(initialState.isFromCache);

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
          // First load: fetch current front page from Firebase
          const frontPage = await fetchCurrentTopStories(30);
          
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
  }, [type]);

  return { stories, loading, error, hasMore, loadMore, reset, isFromCache };
}

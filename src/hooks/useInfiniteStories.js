import { useState, useCallback, useRef } from 'react';
import { fetchCurrentTopStories, fetchFrontPageForDay, fetchBestStories } from '../api/hn';

export function useInfiniteStories(type = 'top') {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  
  // For top: 0 = current front page (Firebase), 1+ = days ago (Algolia)
  // For best: tracks offset into the list
  const positionRef = useRef(0);
  const seenIdsRef = useRef(new Set());
  // Version counter to cancel stale responses
  const versionRef = useRef(0);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;

    setLoading(true);
    setError(null);
    
    // Capture current version to check if response is stale
    const currentVersion = versionRef.current;

    try {
      if (type === 'top') {
        let newStories = [];
        
        if (positionRef.current === 0) {
          // First load: fetch current front page from Firebase
          const frontPage = await fetchCurrentTopStories(30);
          
          // Check if we've been reset during the fetch
          if (versionRef.current !== currentVersion) return;
          
          newStories = frontPage.filter(story => {
            if (seenIdsRef.current.has(story.id)) {
              return false;
            }
            seenIdsRef.current.add(story.id);
            return true;
          });
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
          setStories(prev => [...prev, ...newStories]);
        }
      } else {
        // Best stories: offset-based pagination using Firebase
        const result = await fetchBestStories(positionRef.current, 30);
        
        // Check if we've been reset during the fetch
        if (versionRef.current !== currentVersion) return;
        
        // Filter out duplicates
        const uniqueStories = result.stories.filter(story => {
          if (seenIdsRef.current.has(story.id)) {
            return false;
          }
          seenIdsRef.current.add(story.id);
          return true;
        });

        positionRef.current = result.nextOffset;
        setHasMore(result.hasMore);
        
        if (uniqueStories.length > 0) {
          setStories(prev => [...prev, ...uniqueStories]);
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
    setStories([]);
    setLoading(false);
    setError(null);
    setHasMore(true);
    positionRef.current = 0;
    seenIdsRef.current.clear();
  }, []);

  return { stories, loading, error, hasMore, loadMore, reset };
}

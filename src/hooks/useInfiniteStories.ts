import { useState, useCallback, useRef } from 'react';
import { fetchTopStories, fetchFrontPageForDay, fetchBestStories, fetchShowStories, fetchAskStories } from '../api/hn';
import { getCachedFeed, setCachedFeed } from '../utils/feedCache';
import { getListSessionState, saveListSessionState, clearListSessionState } from '../utils/itemCache';
import type { StoryItem, FeedType, ListSessionState } from '../types';

interface InitialState {
  stories: StoryItem[];
  isFromCache: boolean;
  isFromSession: boolean;
  sessionState: ListSessionState | null;
}

// Prefer session state for instant back-nav; fall back to localStorage cache.
function getInitialState(type: FeedType): InitialState {
  const sessionState = getListSessionState(type);
  if (sessionState && sessionState.storyIds.length > 0) {
    // Reconstruct ordered story list from the LocalStorage cache.
    const cached = getCachedFeed(type);
    if (cached && cached.stories.length > 0) {
      const storyMap = new Map(cached.stories.map(s => [s.id, s]));
      const stories = sessionState.storyIds
        .map((id: number) => storyMap.get(id))
        .filter((s): s is StoryItem => Boolean(s));
      
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
  
  const cached = getCachedFeed(type);
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

export function useInfiniteStories(type: FeedType = 'top') {
  // Lazy initialization: sync read from localStorage on first render (called once)
  const [initialState] = useState(() => getInitialState(type));
  const [stories, setStories] = useState(initialState.stories);
  const [isFromCache, setIsFromCache] = useState(initialState.isFromCache);
  const [isFromSession, setIsFromSession] = useState(initialState.isFromSession);
  const [initialScrollY, setInitialScrollY] = useState(initialState.sessionState?.scrollY ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(
    initialState.sessionState?.hasMore ?? true
  );
  
  // For top: 0 = current front page (Firebase), 1+ = days ago (Algolia)
  // For best: tracks offset into the list
  const positionRef = useRef(
    initialState.sessionState?.position ?? 0
  );
  const seenIdsRef = useRef<Set<number>>(
    new Set(initialState.sessionState?.seenIds)
  );
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
        let newStories: StoryItem[] = [];
        const isRevalidating = hasStaleCacheRef.current && positionRef.current === 0;
        
        if (positionRef.current === 0) {
          const frontPage = await fetchTopStories(20);
          
          if (versionRef.current !== currentVersion) return;
          
          // Revalidation REPLACES all stories — clear seenIds so nothing gets dropped.
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
          
          if (newStories.length > 0) {
            setCachedFeed(type, newStories);
            setIsFromCache(false);
            hasStaleCacheRef.current = false;
          }
          
          positionRef.current = 1; // Next load will be yesterday
        } else {
          // Subsequent loads: day-based pagination using Algolia.
          let attempts = 0;
          const maxAttempts = 5; // Try up to 5 days if current day has no stories

          while (newStories.length === 0 && attempts < maxAttempts && positionRef.current < 365) {
            const dayStories = await fetchFrontPageForDay(positionRef.current);
            
            if (versionRef.current !== currentVersion) return;
            
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

        if (versionRef.current !== currentVersion) return;

        if (newStories.length === 0 && positionRef.current >= 365) {
          setHasMore(false);
        } else if (newStories.length > 0) {
          if (isRevalidating) {
            setStories(newStories);
          } else {
            setStories(prev => [...prev, ...newStories]);
          }
        }
      } else if (type === 'best') {
        // Offset-based pagination via Firebase /beststories.
        const isRevalidatingBest = hasStaleCacheRef.current && positionRef.current === 0;
        const result = await fetchBestStories(positionRef.current, 30);
        
        if (versionRef.current !== currentVersion) return;
        
        if (isRevalidatingBest) {
          seenIdsRef.current.clear();
        }
        
        const uniqueStories = result.stories.filter(story => {
          if (seenIdsRef.current.has(story.id)) {
            return false;
          }
          seenIdsRef.current.add(story.id);
          return true;
        });

        if (positionRef.current === 0 && uniqueStories.length > 0) {
          setCachedFeed(type, uniqueStories);
          setIsFromCache(false);
          hasStaleCacheRef.current = false;
        }

        positionRef.current = result.nextOffset;
        setHasMore(result.hasMore);
        
        if (uniqueStories.length > 0) {
          if (isRevalidatingBest) {
            setStories(uniqueStories);
          } else {
            setStories(prev => [...prev, ...uniqueStories]);
          }
        }
      } else if (type === 'show' || type === 'ask') {
        // Show HN / Ask HN: day-based pagination, top 20 per 24-hour window, via Algolia.
        const fetchFn = type === 'show' ? fetchShowStories : fetchAskStories;
        const isRevalidating = hasStaleCacheRef.current && positionRef.current === 0;
        const result = await fetchFn(positionRef.current);
        
        if (versionRef.current !== currentVersion) return;
        
        if (isRevalidating) {
          seenIdsRef.current.clear();
        }
        
        const uniqueStories = result.stories.filter(story => {
          if (seenIdsRef.current.has(story.id)) {
            return false;
          }
          seenIdsRef.current.add(story.id);
          return true;
        });

        if (positionRef.current === 0 && uniqueStories.length > 0) {
          setCachedFeed(type, uniqueStories);
          setIsFromCache(false);
          hasStaleCacheRef.current = false;
        }

        positionRef.current = result.nextWindow;
        setHasMore(result.hasMore);
        
        if (uniqueStories.length > 0) {
          if (isRevalidating) {
            setStories(uniqueStories);
          } else {
            setStories(prev => [...prev, ...uniqueStories]);
          }
        }
      }
    } catch (err) {
      // Stale-response guard: only surface errors from the current request.
      if (versionRef.current === currentVersion) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    } finally {
      if (versionRef.current === currentVersion) {
        setLoading(false);
      }
    }
  }, [loading, hasMore, type]);

  const reset = useCallback(() => {
    versionRef.current += 1;
    
    const initial = getInitialState(type);
    setStories(initial.stories);
    setIsFromCache(initial.isFromCache);
    // We're starting fresh, not restoring — so explicitly drop session-restore flags.
    setIsFromSession(false);
    setInitialScrollY(0);
    hasStaleCacheRef.current = initial.isFromCache;
    
    setLoading(false);
    setError(null);
    setHasMore(true);
    positionRef.current = 0;
    seenIdsRef.current.clear();
    clearListSessionState(type);
  }, [type]);

  // Save session state for instant back navigation
  const saveSessionState = useCallback((scrollY = window.scrollY) => {
    if (stories.length === 0) return;
    
    saveListSessionState(type, {
      scrollY,
      storyIds: stories.map(s => s.id),
      position: positionRef.current,
      seenIds: [...seenIdsRef.current],
      hasMore,
    });
    
    // Also update the stories cache with current full list (for session reconstruction)
    if (stories.length > 0) {
      setCachedFeed(type, stories);
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
  } as const;
}

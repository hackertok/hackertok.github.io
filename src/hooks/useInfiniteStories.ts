/**
 * Infinite-scroll data source for the main feed pages.
 *
 * Three-tier restore: sessionStorage → localStorage cache → network.
 * Stale responses discarded via a monotonic version counter.
 * Deduplication across pages via a `seenIds` set.
 */
import { useState, useCallback, useRef } from 'react';
import { fetchTopStories, fetchFrontPageForDay, fetchBestStories, fetchNewStories, fetchShowStories, fetchAskStories, fetchAskStoriesForDay, fetchShowStoriesForDay } from '../api/hn';
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
  // Safety fallback: if phase is missing but position > 200, it's a corrupt session blob
  const safePosition = (() => {
    const session = initialState.sessionState;
    if (session && !session.phase && session.position > 200) return 0;
    return session?.position ?? 0;
  })();
  const positionRef = useRef(safePosition);
  const seenIdsRef = useRef<Set<number>>(
    new Set(initialState.sessionState?.seenIds)
  );
  const versionRef = useRef(0);
  const hasStaleCacheRef = useRef(initialState.isFromCache);
  // For ask/show: tracks whether we've exhausted Firebase and moved to Algolia
  const phaseRef = useRef<'firebase' | 'algolia'>(
    (() => {
      const session = initialState.sessionState;
      if (!session) return 'firebase';
      if (!session.phase && session.position > 200) return 'firebase';
      return session.phase ?? 'firebase';
    })()
  );

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
      } else if (type === 'best' || type === 'newest') {
        // Offset-based pagination via Firebase /beststories or /newstories.
        const isRevalidatingBest = hasStaleCacheRef.current && positionRef.current === 0;
        const fetchFn = type === 'best' ? fetchBestStories : fetchNewStories;
        const result = await fetchFn(positionRef.current, 30);
        
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
        const isRevalidating = hasStaleCacheRef.current && positionRef.current === 0;

        if (phaseRef.current === 'firebase') {
          const fetchFn = type === 'show' ? fetchShowStories : fetchAskStories;
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

          positionRef.current = result.nextOffset;

          // Boundary: Firebase exhausted → transition to Algolia
          if (!result.hasMore) {
            phaseRef.current = 'algolia';
            positionRef.current = 1; // Start with yesterday
            // Do NOT call setHasMore(false) — Algolia has more content
          }

          if (uniqueStories.length > 0) {
            if (isRevalidating) {
              setStories(uniqueStories);
            } else {
              setStories(prev => [...prev, ...uniqueStories]);
            }
          }
        } else {
          // Algolia phase: fetch day-by-day
          const fetchDayFn = type === 'ask' ? fetchAskStoriesForDay : fetchShowStoriesForDay;
          let newStories: StoryItem[] = [];
          let attempts = 0;
          const maxAttempts = 14;

          while (newStories.length === 0 && attempts < maxAttempts && positionRef.current < 365) {
            const dayStories = await fetchDayFn(positionRef.current);

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

          if (versionRef.current !== currentVersion) return;

          if (newStories.length === 0 && positionRef.current >= 365) {
            setHasMore(false);
          } else if (newStories.length > 0) {
            setStories(prev => [...prev, ...newStories]);
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
    phaseRef.current = 'firebase';
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
      phase: phaseRef.current,
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

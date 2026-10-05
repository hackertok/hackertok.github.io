/**
 * Infinite-scroll data source for the main feed pages.
 *
 * Three-tier restore: sessionStorage → localStorage cache → network.
 * Stale responses discarded via a monotonic version counter.
 * Deduplication across pages via a `seenIds` set.
 */
import { useState, useCallback, useRef, useLayoutEffect } from 'react';
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
  
  return getCachedState(type);
}

function getCachedState(type: FeedType): InitialState {
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
  // `loading` alone can't guard: two effects calling loadMore in the same
  // commit both still see the old `loading === false`.
  const inFlightRef = useRef(false);
  const hasStaleCacheRef = useRef(initialState.isFromCache);
  const storiesRef = useRef(stories);
  const keptIdsRef = useRef<ReadonlySet<number>>(new Set());

  useLayoutEffect(() => {
    storiesRef.current = stories;
  }, [stories]);
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
    if (loading || !hasMore || inFlightRef.current) return;
    inFlightRef.current = true;

    setLoading(true);
    setError(null);
    
    // Capture current version to check if response is stale
    const currentVersion = versionRef.current;

    // Revalidation REPLACES the stale stories, except the ones passed to
    // keepOnRevalidate. seenIds restarts from those, so nothing fresh gets
    // dropped.
    const startRevalidation = () => {
      const kept = storiesRef.current.filter(story => keptIdsRef.current.has(story.id));
      seenIdsRef.current = new Set(kept.map(story => story.id));
      return kept;
    };

    try {
      if (type === 'top') {
        let newStories: StoryItem[] = [];
        // Set once a refresh's page arrives, which then rebuilds the list even
        // with nothing new on it: the cached stories past the kept ones are no
        // longer in seenIds, so the next page would repeat them.
        let kept: StoryItem[] | null = null;
        const isRevalidating = hasStaleCacheRef.current && positionRef.current === 0;
        
        if (positionRef.current === 0) {
          const frontPage = await fetchTopStories(20);
          
          if (versionRef.current !== currentVersion) return;
          
          if (isRevalidating && frontPage.length > 0) {
            kept = startRevalidation();
          }
          
          newStories = frontPage.filter(story => {
            if (seenIdsRef.current.has(story.id)) {
              return false;
            }
            seenIdsRef.current.add(story.id);
            return true;
          });
          
          // Fresh once the page arrives, even if every story on it was kept:
          // the swipe viewer calls loadMore for as long as isFromCache is set.
          if (frontPage.length > 0) {
            setCachedFeed(type, frontPage);
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
        } else if (kept) {
          setStories([...kept, ...newStories]);
        } else if (newStories.length > 0) {
          setStories(prev => [...prev, ...newStories]);
        }
      } else if (type === 'best' || type === 'newest') {
        // Offset-based pagination via Firebase /beststories or /newstories.
        const isRevalidatingBest = hasStaleCacheRef.current && positionRef.current === 0;
        const fetchFn = type === 'best' ? fetchBestStories : fetchNewStories;
        const result = await fetchFn(positionRef.current, 30);
        
        if (versionRef.current !== currentVersion) return;
        
        // As in the top branch.
        const kept = isRevalidatingBest && result.stories.length > 0 ? startRevalidation() : null;
        
        const uniqueStories = result.stories.filter(story => {
          if (seenIdsRef.current.has(story.id)) {
            return false;
          }
          seenIdsRef.current.add(story.id);
          return true;
        });

        // By the fetched page, as in the top branch.
        if (positionRef.current === 0 && result.stories.length > 0) {
          setCachedFeed(type, result.stories);
          setIsFromCache(false);
          hasStaleCacheRef.current = false;
        }

        positionRef.current = result.nextOffset;
        setHasMore(result.hasMore);
        
        if (kept) {
          setStories([...kept, ...uniqueStories]);
        } else if (uniqueStories.length > 0) {
          setStories(prev => [...prev, ...uniqueStories]);
        }
      } else if (type === 'show' || type === 'ask') {
        const isRevalidating = hasStaleCacheRef.current && positionRef.current === 0;

        if (phaseRef.current === 'firebase') {
          const fetchFn = type === 'show' ? fetchShowStories : fetchAskStories;
          const result = await fetchFn(positionRef.current);

          if (versionRef.current !== currentVersion) return;

          // As in the top branch.
          const kept = isRevalidating && result.stories.length > 0 ? startRevalidation() : null;

          const uniqueStories = result.stories.filter(story => {
            if (seenIdsRef.current.has(story.id)) {
              return false;
            }
            seenIdsRef.current.add(story.id);
            return true;
          });

          // By the fetched page, as in the top branch.
          if (positionRef.current === 0 && result.stories.length > 0) {
            setCachedFeed(type, result.stories);
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

          if (kept) {
            setStories([...kept, ...uniqueStories]);
          } else if (uniqueStories.length > 0) {
            setStories(prev => [...prev, ...uniqueStories]);
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
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [loading, hasMore, type]);

  const reset = useCallback(() => {
    versionRef.current += 1;
    inFlightRef.current = false;
    
    // The cache, not the session: the session's stories paired with the cursor
    // reset below would make the next page repeat them.
    const initial = getCachedState(type);
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

  // The swipe viewer passes the stories from the first through the one on
  // screen: a revalidation that lands after a swipe would otherwise put a
  // different story under the reader.
  const keepOnRevalidate = useCallback((storyIds: readonly number[]) => {
    keptIdsRef.current = new Set(storyIds);
  }, []);

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
    keepOnRevalidate,
  } as const;
}

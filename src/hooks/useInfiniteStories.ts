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
import { errorMessage } from '../utils/errors';
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

// A page request succeeds even when every item read in it fails. A refresh
// that brings nothing back has still failed: as a success it would leave
// isFromCache set, and the callers that refresh eagerly would page through
// the whole feed.
function emptyRefreshError(type: FeedType): Error {
  return new Error(`Failed to fetch ${type} stories: none came back`);
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
  
  const session = initialState.sessionState;
  // A session past position 200 without a phase is a corrupt blob: start over.
  const isCorruptSession = !!session && !session.phase && session.position > 200;
  // For top: 0 = current front page (Firebase), 1+ = days ago (Algolia)
  // For best: tracks offset into the list
  const positionRef = useRef(isCorruptSession ? 0 : session?.position ?? 0);
  // For ask/show: tracks whether we've exhausted Firebase and moved to Algolia
  const phaseRef = useRef<'firebase' | 'algolia'>(isCorruptSession ? 'firebase' : session?.phase ?? 'firebase');
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

    const takeUnseen = (page: StoryItem[]) => page.filter(story => {
      if (seenIdsRef.current.has(story.id)) return false;
      seenIdsRef.current.add(story.id);
      return true;
    });

    // A refresh rebuilds the list even with nothing new on it: the cached
    // stories past the kept ones are no longer in seenIds, so the next page
    // would repeat them.
    const showStories = (kept: StoryItem[] | null, unseen: StoryItem[]) => {
      if (kept) {
        setStories([...kept, ...unseen]);
      } else if (unseen.length > 0) {
        setStories(prev => [...prev, ...unseen]);
      }
    };

    // One page of a Firebase ranked list, from positionRef. Resolves to the
    // list's hasMore, or null when a newer request took over.
    const loadRankedPage = async (
      fetchPage: (offset: number) => Promise<{ stories: StoryItem[]; nextOffset: number; hasMore: boolean }>,
    ) => {
      const isRevalidating = hasStaleCacheRef.current && positionRef.current === 0;
      const page = await fetchPage(positionRef.current);

      if (versionRef.current !== currentVersion) return null;
      if (isRevalidating && page.stories.length === 0) throw emptyRefreshError(type);

      const kept = isRevalidating ? startRevalidation() : null;
      const unseen = takeUnseen(page.stories);

      // Fresh once the first page arrives, even if every story on it was
      // kept: the swipe viewer calls loadMore for as long as isFromCache is set.
      if (positionRef.current === 0 && page.stories.length > 0) {
        setCachedFeed(type, page.stories);
        setIsFromCache(false);
        hasStaleCacheRef.current = false;
      }

      positionRef.current = page.nextOffset;
      showStories(kept, unseen);
      return page.hasMore;
    };

    // Walks back a day at a time from positionRef (days ago) until a day has
    // unseen stories, trying at most maxEmptyDays.
    const loadDays = async (fetchDay: (daysAgo: number) => Promise<StoryItem[]>, maxEmptyDays: number) => {
      let unseen: StoryItem[] = [];
      for (let attempts = 0; unseen.length === 0 && attempts < maxEmptyDays && positionRef.current < 365; attempts++) {
        const day = await fetchDay(positionRef.current);
        if (versionRef.current !== currentVersion) return;
        unseen = takeUnseen(day);
        positionRef.current += 1;
      }

      if (unseen.length === 0 && positionRef.current >= 365) {
        setHasMore(false);
      } else {
        showStories(null, unseen);
      }
    };

    try {
      if (type === 'top') {
        if (positionRef.current === 0) {
          // Next load will be yesterday. By design, today's stories ranked
          // past the top 20 are never shown: the feed is HN's front page,
          // then each earlier (UTC) day's front page from Algolia.
          await loadRankedPage(async () => ({ stories: await fetchTopStories(20), nextOffset: 1, hasMore: true }));
        } else {
          await loadDays(fetchFrontPageForDay, 5);
        }
      } else if (type === 'best' || type === 'newest') {
        const fetchPage = type === 'best' ? fetchBestStories : fetchNewStories;
        const listHasMore = await loadRankedPage(offset => fetchPage(offset, 30));
        if (listHasMore !== null) setHasMore(listHasMore);
      } else if (phaseRef.current === 'firebase') {
        const listHasMore = await loadRankedPage(type === 'show' ? fetchShowStories : fetchAskStories);
        // Firebase exhausted: carry on from Algolia, which has more, starting
        // with yesterday.
        if (listHasMore === false) {
          phaseRef.current = 'algolia';
          positionRef.current = 1;
        }
      } else {
        await loadDays(type === 'ask' ? fetchAskStoriesForDay : fetchShowStoriesForDay, 14);
      }
    } catch (err) {
      // Stale-response guard: only surface errors from the current request.
      if (versionRef.current === currentVersion) {
        setError(errorMessage(err));
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
    
    // Also update the stories cache with current full list (for session
    // reconstruction). Keep the cached timestamp: the list is no newer than
    // its last fetch, and re-stamping it would let a stale list pass as fresh.
    // No cache entry means the list is over a day old, or storage failed.
    const fetchedAt = getCachedFeed(type)?.timestamp;
    if (stories.length > 0 && fetchedAt !== undefined) {
      setCachedFeed(type, stories, fetchedAt);
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

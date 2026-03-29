import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useInfiniteStories } from '../hooks/useInfiniteStories';
import { useSwipeScroll } from '../hooks/useSwipeScroll';
import { usePrefetchItems } from '../hooks/usePrefetchItem';
import { usePrefetchSections } from '../hooks/usePrefetchSections';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { fetchItemOnly } from '../api/hn';
import { getRecentlyViewedIds, getSessionViewedIds, markViewedWithTime } from '../utils/viewedItems';
import { FEED_TYPE_TITLES } from '../config/feedTypes';
import { FullScreenItem, FullScreenItemSkeleton } from './FullScreenItem';
import { Spinner } from './Spinner';
import type { StoryItem, FeedType, LocationState } from '../types';

interface SwipeStoryViewerProps {
  type: FeedType;
  initialItemId?: string;
}

/**
 * Full-screen horizontal swipe item viewer for mobile
 * Uses CSS Scroll Snap for native, smooth horizontal swiping
 * - Horizontal swipe: CSS Scroll Snap handles navigation natively
 * - Vertical scroll: Each item panel scrolls independently
 * - URL updates on each item change
 */
export function SwipeStoryViewer({ type, initialItemId }: SwipeStoryViewerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  const initialItemIdNum = initialItemId != null ? Number(initialItemId) : undefined;
  const { 
    stories, 
    loading, 
    error, 
    hasMore, 
    loadMore 
  } = useInfiniteStories(type);
  
  const [injectedStory, setInjectedStory] = useState<StoryItem | null>(null);
  const [injectedLoading, setInjectedLoading] = useState(false);
  const [injectedError, setInjectedError] = useState<string | null>(null);
  // anchorStoryId: The story that should be at index 0.
  // Only set on FRESH direct links (shared/bookmarked URLs with no location.state).
  // When returning from external URL, location.state is preserved from our earlier navigation,
  // so we DON'T reorder (user expects to return to same position).
  const [anchorStoryId, setAnchorStoryId] = useState<number | null>(() => {
    return locationState?.from ? null : initialItemIdNum ?? null;
  });
  const lastInitialStoryIdRef = useRef(initialItemId);
  const didInitialLoadRef = useRef(false);
  const fetchedStoryIdRef = useRef<number | null>(null);
  const isOurNavigationRef = useRef(false);
  
  // Snapshots at mount for filtering logic:
  // - recentlyViewedOnMount: stories viewed in last 24h (from localStorage)
  // - sessionViewedOnMount: stories viewed THIS session (from sessionStorage)
  // Stories in sessionStorage are NOT filtered (can always go back to them)
  // Stories in localStorage but NOT sessionStorage are filtered
  const [recentlyViewedOnMount] = useState(() => getRecentlyViewedIds(24));
  const [sessionViewedOnMount] = useState(() => getSessionViewedIds());
  
  // Merge injected story (if any) with feed stories, avoiding duplicates
  // Also filter out stories viewed in the last 24 hours (unless viewed this session)
  // IMPORTANT: If anchorStoryId is set, that story is moved to index 0
  const mergedStories = useMemo(() => {
    // Find anchor story in feed (the story that should be first)
    const anchorStory = anchorStoryId
      ? stories.find(s => s.id === anchorStoryId)
      : null;
    
    // Priority for first position:
    // 1. anchorStory (in-feed story user navigated to)
    // 2. injectedStory (out-of-feed story, only if it matches anchorStoryId or no anchor)
    // This ensures navigation to in-feed stories works even if injectedStory exists
    const shouldUseInjectedStory = injectedStory && 
      (!anchorStoryId || injectedStory.id === anchorStoryId);
    const firstStory = anchorStory ?? (shouldUseInjectedStory ? injectedStory : null);
    
    let result = firstStory 
      ? [firstStory, ...stories.filter(s => s.id !== firstStory.id)]
      : stories;
    
    // Also include injectedStory in the list (for swiping back to it)
    // but only if it's not already the firstStory
    if (injectedStory && firstStory !== injectedStory) {
      result = [result[0], injectedStory, ...result.slice(1).filter(s => s.id !== injectedStory.id)];
    }
    
    // Filter out recently-viewed, but always keep:
    // - firstStory (linked story at anchor position)
    // - injectedStory (so user can swipe back to it)
    // - initialItemId (current URL - browser back/forward)
    // - stories viewed THIS session (in sessionStorage)
    const filtered = result.filter(story => 
      story === firstStory ||
      story === injectedStory ||
      story.id === initialItemIdNum ||
      sessionViewedOnMount.has(story.id) ||
      !recentlyViewedOnMount.has(story.id)
    );
    
    // Fallback: if all filtered out, show everything
    return filtered.length > 0 ? filtered : result;
  }, [injectedStory, stories, anchorStoryId, initialItemIdNum, sessionViewedOnMount, recentlyViewedOnMount]);
  
  // Defer listener attachment until the main container (with ref) actually renders.
  // On cold start (no localStorage cache), stories start empty → loading skeleton renders
  // without the ref → the hook's listener effect would silently miss attachment.
  const anchorResolved = !anchorStoryId ||
    mergedStories.some(s => s.id === anchorStoryId);

  const {
    containerRef,
    currentIndex,
    currentIndexRef,
    scrollToIndex,
    isScrollingProgrammaticallyRef,
  } = useSwipeScroll({
    itemCount: mergedStories.length,
    enabled: mergedStories.length > 0 && anchorResolved,
  });

  // Get current story for document title (updates as user swipes)
  const currentStory = mergedStories[currentIndex];
  const isNonStoryError = injectedError === 'job' || injectedError === 'comment';
  const documentTitle = injectedError ? (isNonStoryError ? 'Item not available' : 'Story not found') : (currentStory?.title || FEED_TYPE_TITLES[type]);
  useDocumentTitle(documentTitle);
  
  // Prefetch other sections in background for instant tab switching
  usePrefetchSections(type);
  
  // Trigger initial load when stories are empty or low
  useEffect(() => {
    if (!didInitialLoadRef.current && stories.length < 10 && hasMore && !loading) {
      didInitialLoadRef.current = true;
      void loadMore();
    }
  }, [stories.length, hasMore, loading, loadMore]);
  
  // Fetch story if initialItemId is not in the feed list
  useEffect(() => {
    if (!initialItemId) return;
    
    // Don't wait for stories to load - fetch immediately if this is a direct navigation
    const storyInList = stories.some(s => s.id === initialItemIdNum);
    if (storyInList) {
      // Story found in feed, clear any injected story (use rAF to avoid sync setState)
      if (injectedStory && injectedStory.id === initialItemIdNum) {
        requestAnimationFrame(() => setInjectedStory(null));
      }
      // Clear stale state from a previous failed navigation (e.g. back from /item/99999999).
      // Reset fetchedStoryIdRef so navigating forward to the failed story re-fetches it.
      if (injectedError) setInjectedError(null);
      fetchedStoryIdRef.current = null;
      return;
    }
    
    // Already fetched this story?
    if (fetchedStoryIdRef.current === initialItemIdNum) return;
    if (injectedStory && injectedStory.id === initialItemIdNum) return;
    
    // Mark that we're fetching this story
    fetchedStoryIdRef.current = initialItemIdNum ?? null;
    // Use queueMicrotask to avoid sync setState in effect (per eslint rule)
    queueMicrotask(() => {
      setInjectedLoading(true);
      setInjectedError(null); // Clear stale error from previous fetch
    });
    
    const controller = new AbortController();
    let fetchCompleted = false;
    
    void fetchItemOnly(initialItemId, controller.signal)
      .then(fetchedItem => {
        fetchCompleted = true;
        if (controller.signal.aborted) return;
        // Race condition guard: user may have swiped to another story while fetching.
        // Only update state if this fetch result matches the story we're still waiting for.
        if (fetchedItem.id === fetchedStoryIdRef.current) {
          // Only inject stories (not comments or jobs)
          if (fetchedItem.type === 'comment' || fetchedItem.type === 'job') {
            setInjectedLoading(false);
            setInjectedError(fetchedItem.type === 'job' ? 'job' : 'comment');
            return;
          }
          setInjectedStory(fetchedItem);
          setInjectedLoading(false);
          setInjectedError(null);
        }
      })
      .catch((err: unknown) => {
        fetchCompleted = true;
        if (controller.signal.aborted) return;
        console.error('Failed to fetch item:', err);
        // Only update state if this is still the story we want
        if (initialItemIdNum === fetchedStoryIdRef.current) {
          setInjectedLoading(false);
          setInjectedError(err instanceof Error ? err.message : 'Story not found');
        }
      });
    
    return () => {
      controller.abort();
      // Only reset the ref when the fetch was aborted mid-flight (e.g. `stories`
      // loaded and the effect re-ran). If the fetch already completed (success or
      // error), the ref must stay so the next effect run skips the re-fetch — otherwise
      // injectedError would be cleared and re-set in an infinite loop.
      if (!fetchCompleted && fetchedStoryIdRef.current === initialItemIdNum) {
        fetchedStoryIdRef.current = null;
      }
    };
  }, [initialItemId, initialItemIdNum, stories, injectedStory, injectedError]);
  
  // Scroll to index 0 when injected story arrives and is anchored
  // This handles: user navigates to out-of-feed story, we fetch it, then scroll to it
  // Track which story we've scrolled to (not just if we scrolled) - handles multiple navigations
  const scrolledToInjectedStoryIdRef = useRef<number | null>(null);
  
  useLayoutEffect(() => {
    if (!injectedStory || !anchorStoryId) return;
    if (injectedStory.id !== anchorStoryId) return;
    
    // Already scrolled to this specific story?
    if (scrolledToInjectedStoryIdRef.current === injectedStory.id) return;
    scrolledToInjectedStoryIdRef.current = injectedStory.id;
    
    // Injected story just arrived and matches anchor - scroll to index 0
    scrollToIndex(0);
  }, [injectedStory, anchorStoryId, scrollToIndex]);
  
  // Restore scroll position when returning from external URL
  // Uses both pageshow (for bfcache) and visibilitychange (for tab switches)
  // pageshow fires BEFORE first paint on bfcache restore - critical for preventing flash
  const savedIndexOnHideRef = useRef<number | null>(null);
  
  useEffect(() => {
    // Save position when page is about to be hidden/cached
    const handlePageHide = () => {
      savedIndexOnHideRef.current = currentIndexRef.current;
    };
    
    // Restore position when page is shown from bfcache (persisted=true)
    // This fires BEFORE first paint, preventing flash of wrong item
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && savedIndexOnHideRef.current !== null) {
        const targetIndex = savedIndexOnHideRef.current;
        savedIndexOnHideRef.current = null;
        scrollToIndex(targetIndex);
      }
    };
    
    // Fallback: visibilitychange for non-bfcache cases (tab switches, etc)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        savedIndexOnHideRef.current = currentIndexRef.current;
      } else if (document.visibilityState === 'visible' && savedIndexOnHideRef.current !== null) {
        const targetIndex = savedIndexOnHideRef.current;
        savedIndexOnHideRef.current = null;
        scrollToIndex(targetIndex);
      }
    };
    
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentIndexRef, scrollToIndex]);
  
  // Handle initial scroll position when returning from external URL (no anchor)
  // This runs once when items load and we have an initialItemId but didn't anchor
  const hasInitializedScrollRef = useRef(false);
  const pendingScrollToStoryIdRef = useRef<number | null>(null);
  
  // Handle navigation changes (browser back/forward, direct URL entry)
  // IMPORTANT: This must be declared BEFORE the scroll-init effect below.
  // useLayoutEffects run in declaration order. On browser back/forward, this handler
  // scrolls directly when the target story is in the list. Only defers to scroll-init
  // when stories haven't loaded yet.
  useLayoutEffect(() => {
    // Check if initialItemId changed
    if (lastInitialStoryIdRef.current !== initialItemId) {
      // Check if WE caused this navigation (via URL update effect)
      if (isOurNavigationRef.current) {
        // We're already at the correct position - just update tracking ref
        isOurNavigationRef.current = false;
        lastInitialStoryIdRef.current = initialItemId;
        return;
      }
      
      lastInitialStoryIdRef.current = initialItemId;
      
      if (initialItemId) {
        // Check if this is a fresh direct link (no location.state) or history navigation
        const isHistoryNavigation = !!locationState?.from;
        
        if (isHistoryNavigation) {
          // History navigation (browser back/forward, return from external)
          // Clear stale anchor so scroll-init isn't blocked if we defer
          if (anchorStoryId) setAnchorStoryId(null);
          // Clear stale error (e.g. back from "story not found" page) so the
          // scroll container renders on the next paint instead of the error div.
          if (injectedError) setInjectedError(null);
          
          // Try to scroll directly to the story's position
          const idx = mergedStories.findIndex(s => s.id === initialItemIdNum);
          if (idx >= 0 && containerRef.current) {
            hasInitializedScrollRef.current = true;
            scrollToIndex(idx);
          } else {
            // Story not in list yet OR container not available (e.g. error state clearing)
            // — defer to scroll-init effect
            pendingScrollToStoryIdRef.current = initialItemIdNum ?? null;
            hasInitializedScrollRef.current = false;
          }
        } else {
          // Fresh direct link (share/bookmark) - anchor so story is at index 0
          setAnchorStoryId(initialItemIdNum ?? null);
          scrollToIndex(0);
        }
      }
    }
  }, [initialItemId, initialItemIdNum, locationState, anchorStoryId, mergedStories, injectedError, containerRef, scrollToIndex]);
  
  // Scroll-init: restore scroll position to the target story.
  // Runs after the navigation handler above has set pendingScrollToStoryIdRef.
  useLayoutEffect(() => {
    // Skip if already initialized for this story, or if we're anchoring (story at index 0)
    if (hasInitializedScrollRef.current || anchorStoryId) return;
    
    // Check if we have a pending scroll target
    const targetStoryId = pendingScrollToStoryIdRef.current ?? initialItemIdNum;
    if (!targetStoryId) return;
    
    // Wait for stories to load
    if (mergedStories.length === 0) return;
    
    // Find the story's position
    const idx = mergedStories.findIndex(s => s.id === targetStoryId);
    if (idx >= 0) {
      pendingScrollToStoryIdRef.current = null;
      hasInitializedScrollRef.current = true;
      scrollToIndex(idx);
    }
  }, [mergedStories, initialItemId, initialItemIdNum, anchorStoryId, scrollToIndex]);
  
  // Prefetch next 3 stories
  usePrefetchItems(currentIndex, mergedStories, 6);
  
  // Mark stories WITHOUT external URL as viewed on swipe (Ask HN, text posts)
  // Stories WITH URLs are marked when user clicks the external link (in FullScreenItem)
  useEffect(() => {
    const currentStory = mergedStories[currentIndex];
    if (currentStory && !currentStory.url) {
      markViewedWithTime(currentStory.id);
    }
  }, [currentIndex, mergedStories]);
  
  // Load more stories when approaching the end
  useEffect(() => {
    const storiesAhead = mergedStories.length - 1 - currentIndex;
    const needsMore = storiesAhead < 5 || mergedStories.length < 10;
    
    if (needsMore && hasMore && !loading) {
      void loadMore();
    }
  }, [currentIndex, mergedStories.length, hasMore, loading, loadMore]);
  
  // Update URL when currentIndex changes
  useEffect(() => {
    // Don't update URL if we have an error (story not found)
    if (injectedError) return;
    
    // Don't update URL while a programmatic scroll is in progress (e.g. scroll-init on
    // refresh). currentIndex may not yet reflect the target position — writing the URL
    // now would cause a brief flicker to the wrong story ID.
    if (isScrollingProgrammaticallyRef.current) return;
    
    // If we have an initialItemId from the URL, don't overwrite it until:
    // 1. The story is found in the feed (user can swipe from it)
    // 2. OR the story is resolved via fetch (injectedStory)
    // This prevents the URL from reverting when navigating to a story not yet loaded
    if (initialItemId) {
      const storyInFeed = mergedStories.some(s => s.id === initialItemIdNum);
      const storyInjected = injectedStory && injectedStory.id === initialItemIdNum;
      // If the target story isn't resolved yet, don't update URL
      if (!storyInFeed && !storyInjected) return;
    }
    
    if (mergedStories.length > 0 && mergedStories[currentIndex]) {
      const storyId = mergedStories[currentIndex].id;
      const newPath = `/item/${storyId}`;
      
      if (location.pathname !== newPath) {
        // Mark that WE are causing this navigation, so sync effect won't re-initialize
        isOurNavigationRef.current = true;
        // Always replace: swipe-driven URL changes keep the URL in sync for
        // sharing/bookmarking, but don't create history entries. Without this,
        // Chrome's History Manipulation Intervention marks non-interaction pushState
        // calls as skippable (scrollend → useEffect → navigate is too indirect),
        // which breaks the back button entirely. Back navigates to the previous
        // section instead.
        void navigate(newPath, { 
          replace: true, 
          state: { from: type }
        });
      }
    }
  }, [currentIndex, mergedStories, navigate, location.pathname, type, injectedError, initialItemId, initialItemIdNum, injectedStory, isScrollingProgrammaticallyRef]);
  
  // Error state (direct navigation to non-existent or non-story item)
  if (injectedError) {
    const isNonStory = injectedError === 'job' || injectedError === 'comment';
    return (
      <div className="swipe-snap-container flex items-center justify-center min-h-screen" data-testid="swipe-container">
        <div className="text-center px-4">
          <p className="text-muted-foreground mb-4">
            {isNonStory ? 'This item is not a story' : 'Story not found'}
          </p>
          <Link
            to="/"
            className="text-accent hover:underline"
          >
            Back to feed
          </Link>
        </div>
      </div>
    );
  }
  
  // Direct navigation to a specific story - wait until we resolve it
  // This prevents falling through to showing first story in list while fetch is pending
  // Only block if we're still trying to show the anchored story (initialItemId matches).
  // If the user navigated away (e.g. browser back), the anchor is stale — don't block.
  if (anchorStoryId && initialItemIdNum === anchorStoryId) {
    const anchorInFeed = mergedStories.some(s => s.id === anchorStoryId);
    const anchorIsInjected = injectedStory?.id === anchorStoryId;
    
    // If anchor story isn't resolved yet (not in feed, not injected), show loading skeleton
    // This ensures we wait for fetchItemOnly to complete before deciding what to show
    if (!anchorInFeed && !anchorIsInjected) {
      return (
        <div className="swipe-snap-container" data-testid="swipe-container">
          <div className="swipe-snap-panel" data-testid="swipe-panel">
            <FullScreenItemSkeleton />
          </div>
        </div>
      );
    }
  }
  
  // Initial loading state (also show when fetching injected story)
  if (mergedStories.length === 0 && (loading || injectedLoading)) {
    return (
      <div className="swipe-snap-container" data-testid="swipe-container">
        <div className="swipe-snap-panel" data-testid="swipe-panel">
          <FullScreenItemSkeleton />
        </div>
      </div>
    );
  }
  
  // Error state
  if (error && mergedStories.length === 0) {
    return (
      <div className="swipe-snap-container flex items-center justify-center" data-testid="swipe-container">
        <div className="text-center px-4">
          <p className="text-destructive mb-4">Failed to load stories</p>
          <button
            onClick={loadMore}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent-hover transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }
  
  // Virtualization: only render panels within this window around currentIndex
  // Buffer of 2 ensures smooth swiping (pre-rendered neighbors) while keeping DOM light
  // Total rendered: up to 5 panels (current + 2 before + 2 after)
  const VIRTUALIZE_BUFFER = 2;
  
  return (
    <div 
      ref={containerRef}
      className="swipe-snap-container"
      data-testid="swipe-container"
    >
      {mergedStories.map((story, index) => {
        // Only render FullScreenItem for panels within virtualization window
        const distance = Math.abs(index - currentIndex);
        const isWithinWindow = distance <= VIRTUALIZE_BUFFER;
        // Current + adjacent panels are priority (fetch in parallel for smooth swiping)
        const isPriority = distance <= 1;
        // Far panels (distance > 1) defer comment fetch entirely to reduce concurrent requests
        // Note: linked story is always at index 0 (reordered), so it's never deferred
        const deferComments = distance > 1;
        
        return (
          <div 
            key={story.id} 
            className="swipe-snap-panel"
            data-testid="swipe-panel"
            data-item-id={story.id}
          >
            {isWithinWindow ? (
              <FullScreenItem
                itemId={story.id}
                initialItem={story}
                isPriority={isPriority}
                deferComments={deferComments}
              />
            ) : (
              // Skeleton placeholder for non-visible panels (consistent UX during quick swipes)
              <FullScreenItemSkeleton />
            )}
          </div>
        );
      })}
      
      {/* Loading indicator at the end */}
      {loading && mergedStories.length > 0 && (
        <div className="swipe-snap-panel flex items-center justify-center" data-testid="swipe-panel-loading">
          <Spinner />
        </div>
      )}
    </div>
  );
}

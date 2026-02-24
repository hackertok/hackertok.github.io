import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useInfiniteStories } from '../hooks/useInfiniteStories';
import { useScrollContainer } from '../context/ScrollContainerContext';
import { usePrefetchStories } from '../hooks/usePrefetchStory';
import { usePrefetchSections } from '../hooks/usePrefetchSections';
import { fetchStoryOnly } from '../api/hn';
import { getRecentlyViewedIds, getSessionViewedIds, markViewedWithTime } from '../utils/viewedStories';
import { FullScreenStory, FullScreenStorySkeleton } from './FullScreenStory';
import { Spinner } from './Spinner';

/**
 * TikTok-style horizontal swipe story viewer for mobile
 * Uses CSS Scroll Snap for native, smooth horizontal swiping (industry standard)
 * - Horizontal swipe: CSS Scroll Snap handles navigation natively
 * - Vertical scroll: Each story panel scrolls independently
 * - URL updates on each story change
 */
export function SwipeStoryViewer({ type, initialStoryId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    stories, 
    loading, 
    error, 
    hasMore, 
    loadMore 
  } = useInfiniteStories(type);
  
  const { enableSwipeMode, disableSwipeMode } = useScrollContainer();
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [injectedStory, setInjectedStory] = useState(null);
  const [injectedLoading, setInjectedLoading] = useState(false);
  const containerRef = useRef(null);
  const hasInitializedRef = useRef(false);
  const lastInitialStoryIdRef = useRef(initialStoryId);
  const didInitialLoadRef = useRef(false);
  const isScrollingProgrammatically = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const fetchedStoryIdRef = useRef(null);
  // Tracks when scroll position initialization is truly complete (after rAF executes).
  // Guards URL updates to prevent race condition on page reload.
  const isPositionInitializedRef = useRef(!initialStoryId);
  // Tracks whether WE caused the URL change (vs browser back/forward).
  // When true, sync effect should skip re-initialization since we're already at correct position.
  const isOurNavigationRef = useRef(false);
  // Refs for scroll handler to avoid recreating listener on state changes
  const currentIndexRef = useRef(currentIndex);
  const storiesLengthRef = useRef(0);
  
  // Snapshots at mount for filtering logic:
  // - recentlyViewedOnMount: stories viewed in last 24h (from localStorage)
  // - sessionViewedOnMount: stories viewed THIS session (from sessionStorage)
  // Stories in sessionStorage are NOT filtered (can always go back to them)
  // Stories in localStorage but NOT sessionStorage are filtered
  const [recentlyViewedOnMount] = useState(() => getRecentlyViewedIds(24));
  const [sessionViewedOnMount] = useState(() => getSessionViewedIds());
  
  // Merge injected story (if any) with feed stories, avoiding duplicates
  // Also filter out stories viewed in the last 24 hours (unless viewed this session)
  const mergedStories = useMemo(() => {
    let result = injectedStory 
      ? [injectedStory, ...stories.filter(s => String(s.id) !== String(injectedStory.id))]
      : stories;
    
    // Filter out recently-viewed, but always keep:
    // - injectedStory (shared link)
    // - initialStoryId (current URL - browser back/forward)
    // - stories viewed THIS session (in sessionStorage)
    const filtered = result.filter(story => 
      story === injectedStory ||
      String(story.id) === String(initialStoryId) ||
      sessionViewedOnMount.has(Number(story.id)) ||
      !recentlyViewedOnMount.has(Number(story.id))
    );
    
    // Fallback: if all filtered out, show everything
    return filtered.length > 0 ? filtered : result;
  }, [injectedStory, stories, initialStoryId, sessionViewedOnMount, recentlyViewedOnMount]);
  
  // Keep refs in sync for scroll handler (avoids recreating listener on state changes)
  // useLayoutEffect ensures refs are updated synchronously before any scroll events fire
  useLayoutEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  
  useLayoutEffect(() => {
    storiesLengthRef.current = mergedStories.length;
  }, [mergedStories.length]);
  
  // Prefetch other sections in background for instant tab switching
  usePrefetchSections(type);
  
  // Enable swipe mode on mount, disable on unmount
  // useLayoutEffect runs synchronously before paint, preventing scrollbar flash on reload
  useLayoutEffect(() => {
    enableSwipeMode();
    return () => disableSwipeMode();
  }, [enableSwipeMode, disableSwipeMode]);
  
  // Trigger initial load when stories are empty or low
  useEffect(() => {
    if (!didInitialLoadRef.current && stories.length < 10 && hasMore && !loading) {
      didInitialLoadRef.current = true;
      loadMore();
    }
  }, [stories.length, hasMore, loading, loadMore]);
  
  // Fetch story if initialStoryId is not in the feed list
  useEffect(() => {
    if (!initialStoryId || stories.length === 0) return;
    
    const storyInList = stories.some(s => String(s.id) === String(initialStoryId));
    if (storyInList) {
      // Story found in feed, clear any injected story (use rAF to avoid sync setState)
      if (injectedStory && String(injectedStory.id) === String(initialStoryId)) {
        requestAnimationFrame(() => setInjectedStory(null));
      }
      return;
    }
    
    // Already fetched this story?
    if (fetchedStoryIdRef.current === String(initialStoryId)) return;
    if (injectedStory && String(injectedStory.id) === String(initialStoryId)) return;
    
    // Mark that we're fetching this story
    fetchedStoryIdRef.current = String(initialStoryId);
    // Use queueMicrotask to avoid sync setState in effect (per eslint rule)
    queueMicrotask(() => setInjectedLoading(true));
    
    fetchStoryOnly(initialStoryId)
      .then(story => {
        // Race condition guard: user may have swiped to another story while fetching.
        // Only update state if this fetch result matches the story we're still waiting for.
        if (String(story.id) === fetchedStoryIdRef.current) {
          setInjectedStory(story);
          setInjectedLoading(false);
        }
      })
      .catch(err => {
        console.error('Failed to fetch story:', err);
        // Only clear loading if this is still the story we want
        if (String(initialStoryId) === fetchedStoryIdRef.current) {
          setInjectedLoading(false);
        }
        // Story doesn't exist - continue with feed normally
      });
  }, [initialStoryId, stories, injectedStory]);
  
  // Sync scroll position with initialStoryId when stories load
  useLayoutEffect(() => {
    // Check if initialStoryId changed
    if (lastInitialStoryIdRef.current !== initialStoryId) {
      // Check if WE caused this navigation (via URL update effect)
      if (isOurNavigationRef.current) {
        // We're already at the correct scroll position - just update tracking ref
        isOurNavigationRef.current = false;
        lastInitialStoryIdRef.current = initialStoryId;
        return;
      }
      
      // External navigation (browser back/forward, direct URL entry) - need to re-sync
      hasInitializedRef.current = false;
      // Block URL updates until scroll completes to prevent feedback loop
      isPositionInitializedRef.current = !initialStoryId;
      lastInitialStoryIdRef.current = initialStoryId;
    }
    
    if (hasInitializedRef.current) return;
    
    if (initialStoryId && mergedStories.length > 0) {
      const idx = mergedStories.findIndex(s => String(s.id) === String(initialStoryId));
      if (idx >= 0) {
        hasInitializedRef.current = true;
        // Scroll to the correct position after DOM updates
        // setCurrentIndex is inside rAF to avoid synchronous setState in effect
        requestAnimationFrame(() => {
          setCurrentIndex(idx);
          if (containerRef.current) {
            isScrollingProgrammatically.current = true;
            containerRef.current.scrollTo({
              left: idx * window.innerWidth,
              behavior: 'instant'
            });
            // Reset flag after scroll settles to re-enable scroll event processing.
            // 100ms accounts for instant scroll completion plus small buffer.
            setTimeout(() => {
              isScrollingProgrammatically.current = false;
            }, 100);
          }
          // Mark position as truly initialized - safe to update URL now
          isPositionInitializedRef.current = true;
        });
      }
    } else if (mergedStories.length > 0 && !initialStoryId) {
      hasInitializedRef.current = true;
      isPositionInitializedRef.current = true;
    }
  }, [initialStoryId, mergedStories]);
  
  // Handle scroll events to detect current story (CSS Scroll Snap handles the snapping)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const updateIndex = () => {
      // Clear any pending debounce - scrollend is authoritative
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      
      // Don't update if we're scrolling programmatically or before position is initialized
      if (isScrollingProgrammatically.current || !isPositionInitializedRef.current) return;
      
      const scrollLeft = container.scrollLeft;
      const panelWidth = window.innerWidth;
      const newIndex = Math.round(scrollLeft / panelWidth);
      
      // Use refs to get current values without recreating listener
      if (newIndex !== currentIndexRef.current && newIndex >= 0 && newIndex < storiesLengthRef.current) {
        setCurrentIndex(newIndex);
      }
    };
    
    const handleScroll = () => {
      // Don't process if we're scrolling programmatically or before position is initialized
      if (isScrollingProgrammatically.current || !isPositionInitializedRef.current) return;
      
      // Debounce scroll end detection
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      // Debounce: wait for scroll/snap to settle before calculating position.
      // 150ms allows CSS Scroll Snap animation to complete on slower devices
      // and prevents glitches from mid-swipe index updates.
      // This is a fallback - browsers with scrollend will use that instead.
      scrollTimeoutRef.current = setTimeout(updateIndex, 150);
    };
    
    // scrollend event fires when scroll truly ends (after CSS Scroll Snap animation).
    // Supported in Chrome 114+, Firefox 109+, Safari 18+.
    const hasScrollEnd = 'onscrollend' in window;
    
    if (hasScrollEnd) {
      container.addEventListener('scrollend', updateIndex, { passive: true });
    }
    container.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      if (hasScrollEnd) {
        container.removeEventListener('scrollend', updateIndex);
      }
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []); // Empty deps - uses refs for values
  
  // Prefetch next 3 stories
  usePrefetchStories(currentIndex, mergedStories, 3);
  
  // Mark stories WITHOUT external URL as viewed on swipe (Ask HN, text posts)
  // Stories WITH URLs are marked when user clicks the external link (in FullScreenStory)
  useEffect(() => {
    // Don't mark until scroll position is initialized (prevents marking story at index 0
    // when user navigated directly to a different story's URL)
    if (!isPositionInitializedRef.current) return;
    
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
      loadMore();
    }
  }, [currentIndex, mergedStories.length, hasMore, loading, loadMore]);
  
  // Update URL when currentIndex changes
  useEffect(() => {
    // Don't update URL until scroll position is truly initialized.
    // Prevents race condition on page reload where currentIndex is 0
    // before the initialization effect has scrolled to the correct position.
    if (!isPositionInitializedRef.current) return;
    
    if (mergedStories.length > 0 && mergedStories[currentIndex]) {
      const storyId = mergedStories[currentIndex].id;
      const newPath = `/item/${storyId}`;
      
      if (location.pathname !== newPath) {
        // Mark that WE are causing this navigation, so sync effect won't re-initialize
        isOurNavigationRef.current = true;
        navigate(newPath, { 
          replace: true, 
          state: { from: type }
        });
      }
    }
  }, [currentIndex, mergedStories, navigate, location.pathname, type]);
  
  // If we have an initialStoryId but stories haven't loaded yet, show that story directly
  if (mergedStories.length === 0 && initialStoryId) {
    return (
      <div className="swipe-snap-container">
        <div className="swipe-snap-panel">
          <FullScreenStory
            storyId={initialStoryId}
          />
        </div>
      </div>
    );
  }
  
  // Initial loading state (also show when fetching injected story)
  if (mergedStories.length === 0 && (loading || injectedLoading)) {
    return (
      <div className="swipe-snap-container">
        <div className="swipe-snap-panel">
          <FullScreenStorySkeleton />
        </div>
      </div>
    );
  }
  
  // Error state
  if (error && mergedStories.length === 0) {
    return (
      <div className="swipe-snap-container flex items-center justify-center">
        <div className="text-center px-4">
          <p className="text-red-500 dark:text-red-400 mb-4">Failed to load stories</p>
          <button
            onClick={loadMore}
            className="px-4 py-2 bg-hn-orange text-white rounded-lg hover:bg-orange-600 transition-colors"
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
    >
      {mergedStories.map((story, index) => {
        // Only render FullScreenStory for panels within virtualization window
        const isWithinWindow = Math.abs(index - currentIndex) <= VIRTUALIZE_BUFFER;
        
        return (
          <div 
            key={story.id} 
            className="swipe-snap-panel"
          >
            {isWithinWindow ? (
              <FullScreenStory
                storyId={story.id}
                story={story}
              />
            ) : (
              // Placeholder for non-visible panels (maintains scroll position)
              <div className="flex items-center justify-center h-full">
                <Spinner />
              </div>
            )}
          </div>
        );
      })}
      
      {/* Loading indicator at the end */}
      {loading && mergedStories.length > 0 && (
        <div className="swipe-snap-panel flex items-center justify-center">
          <Spinner />
        </div>
      )}
    </div>
  );
}

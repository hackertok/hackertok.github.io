import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useInfiniteStories } from '../hooks/useInfiniteStories';
import { useScrollContainer } from '../context/ScrollContainerContext';
import { usePrefetchStories } from '../hooks/usePrefetchStory';
import { usePrefetchSections } from '../hooks/usePrefetchSections';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { fetchStoryOnly } from '../api/hn';
import { getRecentlyViewedIds, getSessionViewedIds, markViewedWithTime } from '../utils/viewedStories';
import { STORY_TYPE_TITLES } from '../config/storyTypes';
import { FullScreenStory, FullScreenStorySkeleton } from './FullScreenStory';
import { Spinner } from './Spinner';

/**
 * Full-screen horizontal swipe story viewer for mobile
 * Uses CSS Scroll Snap for native, smooth horizontal swiping
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
  // anchorStoryId: The story that should be at index 0.
  // Only set on FRESH direct links (shared/bookmarked URLs with no location.state).
  // When returning from external URL, location.state is preserved from our earlier navigation,
  // so we DON'T reorder (user expects to return to same position).
  const [anchorStoryId, setAnchorStoryId] = useState(() => {
    // If location.state exists, this is returning from our navigation history (including
    // returning from external URLs) - don't reorder, preserve original position
    return location.state?.from ? null : initialStoryId;
  });
  const containerRef = useRef(null);
  const lastInitialStoryIdRef = useRef(initialStoryId);
  const didInitialLoadRef = useRef(false);
  const isScrollingProgrammatically = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const fetchedStoryIdRef = useRef(null);
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
  // IMPORTANT: If anchorStoryId is set, that story is moved to index 0
  const mergedStories = useMemo(() => {
    // Find anchor story in feed (the story that should be first)
    const anchorStory = anchorStoryId
      ? stories.find(s => String(s.id) === String(anchorStoryId))
      : null;
    
    // Priority for first position:
    // 1. anchorStory (in-feed story user navigated to)
    // 2. injectedStory (out-of-feed story, only if it matches anchorStoryId or no anchor)
    // This ensures navigation to in-feed stories works even if injectedStory exists
    const shouldUseInjectedStory = injectedStory && 
      (!anchorStoryId || String(injectedStory.id) === String(anchorStoryId));
    const firstStory = anchorStory || (shouldUseInjectedStory ? injectedStory : null);
    
    let result = firstStory 
      ? [firstStory, ...stories.filter(s => String(s.id) !== String(firstStory.id))]
      : stories;
    
    // Also include injectedStory in the list (for swiping back to it)
    // but only if it's not already the firstStory
    if (injectedStory && firstStory !== injectedStory) {
      result = [result[0], injectedStory, ...result.slice(1).filter(s => String(s.id) !== String(injectedStory.id))];
    }
    
    // Filter out recently-viewed, but always keep:
    // - firstStory (linked story at anchor position)
    // - injectedStory (so user can swipe back to it)
    // - initialStoryId (current URL - browser back/forward)
    // - stories viewed THIS session (in sessionStorage)
    const filtered = result.filter(story => 
      story === firstStory ||
      story === injectedStory ||
      String(story.id) === String(initialStoryId) ||
      sessionViewedOnMount.has(Number(story.id)) ||
      !recentlyViewedOnMount.has(Number(story.id))
    );
    
    // Fallback: if all filtered out, show everything
    return filtered.length > 0 ? filtered : result;
  }, [injectedStory, stories, anchorStoryId, initialStoryId, sessionViewedOnMount, recentlyViewedOnMount]);
  
  // Get current story for document title (updates as user swipes)
  const currentStory = mergedStories[currentIndex];
  useDocumentTitle(currentStory?.title || STORY_TYPE_TITLES[type]);
  
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
  // Also disable browser's scroll restoration - we handle it ourselves for horizontal scroll
  useLayoutEffect(() => {
    enableSwipeMode();
    // Disable browser's automatic scroll restoration - it doesn't work correctly for
    // horizontal CSS scroll-snap containers and causes flash of wrong story on back navigation
    const previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => {
      disableSwipeMode();
      history.scrollRestoration = previousScrollRestoration;
    };
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
  
  // Scroll to index 0 when injected story arrives and is anchored
  // This handles: user navigates to out-of-feed story, we fetch it, then scroll to it
  // Track which story we've scrolled to (not just if we scrolled) - handles multiple navigations
  const scrolledToInjectedStoryIdRef = useRef(null);
  
  useLayoutEffect(() => {
    if (!injectedStory || !anchorStoryId) return;
    if (String(injectedStory.id) !== String(anchorStoryId)) return;
    
    // Already scrolled to this specific story?
    if (scrolledToInjectedStoryIdRef.current === String(injectedStory.id)) return;
    scrolledToInjectedStoryIdRef.current = String(injectedStory.id);
    
    // Injected story just arrived and matches anchor - scroll to index 0
    isScrollingProgrammatically.current = true;
    setCurrentIndex(0);
    
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollTo({ left: 0, behavior: 'instant' });
      }
      setTimeout(() => {
        isScrollingProgrammatically.current = false;
      }, 100);
    });
  }, [injectedStory, anchorStoryId]);
  
  // Restore scroll position when returning from external URL
  // Uses both pageshow (for bfcache) and visibilitychange (for tab switches)
  // pageshow fires BEFORE first paint on bfcache restore - critical for preventing flash
  const savedIndexOnHideRef = useRef(null);
  
  useEffect(() => {
    // Save position when page is about to be hidden/cached
    const handlePageHide = () => {
      savedIndexOnHideRef.current = currentIndexRef.current;
    };
    
    // Restore position when page is shown from bfcache (persisted=true)
    // This fires BEFORE first paint, preventing flash of wrong story
    const handlePageShow = (event) => {
      if (event.persisted && savedIndexOnHideRef.current !== null) {
        const targetIndex = savedIndexOnHideRef.current;
        savedIndexOnHideRef.current = null;
        
        isScrollingProgrammatically.current = true;
        setCurrentIndex(targetIndex);
        
        if (containerRef.current) {
          const expectedLeft = targetIndex * window.innerWidth;
          containerRef.current.scrollTo({ left: expectedLeft, behavior: 'instant' });
        }
        
        setTimeout(() => {
          isScrollingProgrammatically.current = false;
        }, 100);
      }
    };
    
    // Fallback: visibilitychange for non-bfcache cases (tab switches, etc)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        savedIndexOnHideRef.current = currentIndexRef.current;
      } else if (document.visibilityState === 'visible' && savedIndexOnHideRef.current !== null) {
        const targetIndex = savedIndexOnHideRef.current;
        savedIndexOnHideRef.current = null;
        
        isScrollingProgrammatically.current = true;
        setCurrentIndex(targetIndex);
        
        if (containerRef.current) {
          const expectedLeft = targetIndex * window.innerWidth;
          containerRef.current.scrollTo({ left: expectedLeft, behavior: 'instant' });
        }
        
        setTimeout(() => {
          isScrollingProgrammatically.current = false;
        }, 100);
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
  }, []);
  
  // Handle initial scroll position when returning from external URL (no anchor)
  // This runs once when stories load and we have an initialStoryId but didn't anchor
  const hasInitializedScrollRef = useRef(false);
  const pendingScrollToStoryIdRef = useRef(null);
  
  useLayoutEffect(() => {
    // Skip if already initialized for this story, or if we're anchoring (story at index 0)
    if (hasInitializedScrollRef.current || anchorStoryId) return;
    
    // Check if we have a pending scroll target
    const targetStoryId = pendingScrollToStoryIdRef.current || initialStoryId;
    if (!targetStoryId) return;
    
    // Wait for stories to load
    if (mergedStories.length === 0) return;
    
    // Find the story's position
    const idx = mergedStories.findIndex(s => String(s.id) === String(targetStoryId));
    if (idx >= 0) {
      // Clear pending scroll
      pendingScrollToStoryIdRef.current = null;
      hasInitializedScrollRef.current = true;
      
      // CRITICAL: Set flag BEFORE setCurrentIndex to block any scroll events
      // that might fire during the re-render or browser scroll restoration
      isScrollingProgrammatically.current = true;
      // Synchronous setState is intentional here - URL effect must see correct index immediately
      setCurrentIndex(idx);
      
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTo({ left: idx * window.innerWidth, behavior: 'instant' });
        }
        // Clear flag after scroll settles
        setTimeout(() => {
          isScrollingProgrammatically.current = false;
        }, 100);
      });
    }
  }, [mergedStories, initialStoryId, anchorStoryId]);
  
  // Handle navigation changes (browser back/forward, direct URL entry)
  // When user swipes, WE update the URL (isOurNavigationRef=true) and skip this.
  // When browser navigates, we either anchor (fresh link) or scroll to position (history nav).
  useLayoutEffect(() => {
    // Check if initialStoryId changed
    if (lastInitialStoryIdRef.current !== initialStoryId) {
      // Check if WE caused this navigation (via URL update effect)
      if (isOurNavigationRef.current) {
        // We're already at the correct position - just update tracking ref
        isOurNavigationRef.current = false;
        lastInitialStoryIdRef.current = initialStoryId;
        return;
      }
      
      lastInitialStoryIdRef.current = initialStoryId;
      
      if (initialStoryId) {
        // Check if this is a fresh direct link (no location.state) or history navigation
        const isHistoryNavigation = !!location.state?.from;
        
        if (isHistoryNavigation) {
          // History navigation (browser back/forward, return from external)
          // Check if navigating to the anchored story (it's already at index 0)
          if (anchorStoryId && String(initialStoryId) === String(anchorStoryId)) {
            // Anchored story is at index 0 - just scroll there
            // Set flag BEFORE setCurrentIndex to block scroll events
            isScrollingProgrammatically.current = true;
            // Synchronous setState is intentional - URL effect must see correct index immediately
            setCurrentIndex(0);
            requestAnimationFrame(() => {
              if (containerRef.current) {
                containerRef.current.scrollTo({ left: 0, behavior: 'instant' });
              }
              setTimeout(() => {
                isScrollingProgrammatically.current = false;
              }, 100);
            });
          } else {
            // Don't reorder - scroll to story's natural position
            // Set pending scroll target for the scroll effect to pick up
            pendingScrollToStoryIdRef.current = initialStoryId;
            hasInitializedScrollRef.current = false; // Allow scroll effect to run
          }
        } else {
          // Fresh direct link (share/bookmark) - anchor so story is at index 0
          setAnchorStoryId(initialStoryId);
          // Set flag BEFORE setCurrentIndex to block scroll events
          isScrollingProgrammatically.current = true;
          setCurrentIndex(0);
          requestAnimationFrame(() => {
            if (containerRef.current) {
              containerRef.current.scrollTo({ left: 0, behavior: 'instant' });
            }
            setTimeout(() => {
              isScrollingProgrammatically.current = false;
            }, 100);
          });
        }
      }
    }
  }, [initialStoryId, location.state, anchorStoryId]);
  
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
      
      // Don't update if we're scrolling programmatically
      if (isScrollingProgrammatically.current) return;
      
      const scrollLeft = container.scrollLeft;
      const panelWidth = window.innerWidth;
      const newIndex = Math.round(scrollLeft / panelWidth);
      
      // Use refs to get current values without recreating listener
      if (newIndex !== currentIndexRef.current && newIndex >= 0 && newIndex < storiesLengthRef.current) {
        setCurrentIndex(newIndex);
      }
    };
    
    const handleScroll = () => {
      // Don't process if we're scrolling programmatically
      if (isScrollingProgrammatically.current) return;
      
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
  usePrefetchStories(currentIndex, mergedStories, 6);
  
  // Mark stories WITHOUT external URL as viewed on swipe (Ask HN, text posts)
  // Stories WITH URLs are marked when user clicks the external link (in FullScreenStory)
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
      loadMore();
    }
  }, [currentIndex, mergedStories.length, hasMore, loading, loadMore]);
  
  // Update URL when currentIndex changes
  useEffect(() => {
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
          >
            {isWithinWindow ? (
              <FullScreenStory
                storyId={story.id}
                story={story}
                isPriority={isPriority}
                deferComments={deferComments}
              />
            ) : (
              // Skeleton placeholder for non-visible panels (consistent UX during quick swipes)
              <FullScreenStorySkeleton />
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

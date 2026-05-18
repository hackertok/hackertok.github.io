import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSwipeScroll } from '../hooks/useSwipeScroll';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { useSiblingComments } from '../hooks/useSiblingComments';
import { FullScreenComment, FullScreenCommentSkeletonPanel } from './FullScreenComment';
import { StateView } from './StateView';
import type { LocationState } from '../types';

interface SwipeCommentViewerProps {
  initialCommentId: string;
}

/** Full-screen horizontal swipe comment viewer (mobile). */
export function SwipeCommentViewer({ initialCommentId }: SwipeCommentViewerProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Track a stable comment ID for fetching — only changes on external navigation, not on swipe URL updates
  const [siblingSourceId, setSiblingSourceId] = useState(initialCommentId);
  const { siblingIds, currentIndex: initialIndex, loading, error, retry } = useSiblingComments(siblingSourceId);

  const { isOnline } = useNetworkStatus();
  const { isRetrying } = useAutoRetry({
    error,
    retryFn: retry,
    isOnline,
  });

  const [scrollInitialized, setScrollInitialized] = useState(false);
  const {
    containerRef,
    currentIndex,
    scrollToIndex,
  } = useSwipeScroll({
    itemCount: siblingIds.length,
    initialIndex,
    enabled: scrollInitialized,
  });

  const hasInitializedScrollRef = useRef(false);
  const isOurNavigationRef = useRef(false);
  const lastInitialCommentIdRef = useRef(initialCommentId);

  const currentCommentId = siblingIds[currentIndex];

  // Track comment authors as they load — used for document title
  const [authorsByCommentId, setAuthorsByCommentId] = useState<Record<number, string>>({});
  const handleAuthorLoaded = useCallback((commentId: number, author: string) => {
    setAuthorsByCommentId(prev => prev[commentId] === author ? prev : { ...prev, [commentId]: author });
  }, []);

  const currentAuthor = currentCommentId ? authorsByCommentId[currentCommentId] : undefined;
  useDocumentTitle(currentAuthor ? `Comment by ${currentAuthor}` : 'Comments');

  // Swipe URL updates set isOurNavigationRef → skip. External nav (e.g. "parent"
  // link) → refetch siblings.
  useEffect(() => {
    if (lastInitialCommentIdRef.current !== initialCommentId) {
      if (isOurNavigationRef.current) {
        isOurNavigationRef.current = false;
        lastInitialCommentIdRef.current = initialCommentId;
        return;
      }
      lastInitialCommentIdRef.current = initialCommentId;
      setSiblingSourceId(initialCommentId);
      setScrollInitialized(false);
      hasInitializedScrollRef.current = false;
    }
  }, [initialCommentId]);

  // Scroll-init: scroll to correct position once siblings are loaded
  useLayoutEffect(() => {
    if (hasInitializedScrollRef.current) return;
    if (siblingIds.length === 0 || loading) return;

    const idx = siblingIds.indexOf(Number(initialCommentId));
    const targetIdx = idx >= 0 ? idx : initialIndex;

    hasInitializedScrollRef.current = true;
    setScrollInitialized(true);
    scrollToIndex(targetIdx);
  }, [siblingIds, loading, initialCommentId, initialIndex, scrollToIndex]);

  // URL update on swipe — only after scroll position is initialized.
  // Uses scrollInitialized state (not ref) so it's batched with setCurrentIndex
  // and both take effect in the same render — preventing a stale currentIndex=0 navigation.
  useEffect(() => {
    if (!scrollInitialized) return;
    if (siblingIds.length === 0) return;
    const commentId = siblingIds[currentIndex];
    if (!commentId) return;

    const newPath = `/item/${commentId}`;
    if (location.pathname !== newPath) {
      isOurNavigationRef.current = true;
      void navigate(newPath, {
        replace: true,
        state: { isComment: true } satisfies LocationState
      });
    }
  }, [scrollInitialized, currentIndex, siblingIds, navigate, location.pathname]);

  // Save/restore scrollY for bfcache
  useEffect(() => {
    const handlePageHide = () => {
      try {
        sessionStorage.setItem('__swipe_comment_scrollY', String(window.scrollY));
      } catch { /* quota exceeded — non-critical */ }
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        const savedY = Number(sessionStorage.getItem('__swipe_comment_scrollY')) || 0;
        window.scrollTo(0, savedY);
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  if (loading && siblingIds.length <= 1) {
    return (
      <div className="swipe-snap-container" data-testid="swipe-container">
        <div className="swipe-snap-panel active" data-testid="swipe-panel">
          <FullScreenCommentSkeletonPanel />
        </div>
      </div>
    );
  }

  if (error && siblingIds.length <= 1 && !isRetrying) {
    return (
      <div className="swipe-snap-container flex items-center justify-center" data-testid="swipe-container">
        <StateView variant="error" title="Failed to load comments" description={error} action={{ label: 'Retry', onClick: () => void retry().catch(() => { /* error state set internally */ }) }} />
      </div>
    );
  }

  if (error && siblingIds.length <= 1 && isRetrying) {
    return (
      <div className="swipe-snap-container" data-testid="swipe-container">
        <div className="swipe-snap-panel active" data-testid="swipe-panel">
          <FullScreenCommentSkeletonPanel />
        </div>
      </div>
    );
  }

  const VIRTUALIZE_BUFFER = 2;

  return (
    <div
      ref={containerRef}
      className="swipe-snap-container"
      data-testid="swipe-container"
    >
      {siblingIds.map((id, index) => {
        const distance = Math.abs(index - currentIndex);
        const isWithinWindow = distance <= VIRTUALIZE_BUFFER;

        return (
          <div
            key={id}
            className="swipe-snap-panel"
            data-testid="swipe-panel"
            data-item-id={id}
          >
            {isWithinWindow ? (
              <FullScreenComment commentId={id} onAuthorLoaded={handleAuthorLoaded} />
            ) : (
              <FullScreenCommentSkeletonPanel />
            )}
          </div>
        );
      })}
    </div>
  );
}

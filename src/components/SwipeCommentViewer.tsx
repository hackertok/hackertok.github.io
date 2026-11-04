import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router';
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
  const { siblingIds, hiddenIds, currentIndex: initialIndex, loading, error, retry } = useSiblingComments(siblingSourceId);
  // Skipped rather than left out, so the panels keep their places while a
  // swipe is under way.
  const isSkipped = useCallback((index: number) => hiddenIds.has(siblingIds[index]), [hiddenIds, siblingIds]);

  const { isOnline } = useNetworkStatus();
  const { giveUp } = useAutoRetry({
    error,
    retryFn: retry,
    isOnline,
  });

  const [scrollInitialized, setScrollInitialized] = useState(false);
  const {
    containerRef,
    currentIndex,
    resetToIndex,
  } = useSwipeScroll({
    itemCount: siblingIds.length,
    initialIndex,
    enabled: scrollInitialized,
    isSkipped,
  });

  const hasInitializedScrollRef = useRef(false);
  const isOurNavigationRef = useRef(false);
  const lastInitialCommentIdRef = useRef(initialCommentId);

  // Until its siblings are in, the list holds just the comment being opened.
  // It shows meanwhile, and the swipe starts once they've loaded.
  const isOpening = !scrollInitialized && siblingIds.length === 1;
  const shownIndex = scrollInitialized ? currentIndex : initialIndex;
  const currentCommentId = siblingIds[shownIndex];

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

  // A comment opens at its top, wherever the page before it was.
  useLayoutEffect(() => {
    if (isOpening) window.scrollTo(0, 0);
  }, [isOpening]);

  // Scroll-init: once the siblings are in, the swipe starts on the comment
  // that has been showing, at the reader's place in it. A failed load leaves
  // the list at that one comment, so the swipe waits for the retry.
  useLayoutEffect(() => {
    if (hasInitializedScrollRef.current) return;
    if (siblingIds.length === 0 || loading || error) return;

    const idx = siblingIds.indexOf(Number(initialCommentId));

    hasInitializedScrollRef.current = true;
    setScrollInitialized(true);
    resetToIndex(idx >= 0 ? idx : initialIndex);
    if (idx < 0) window.scrollTo(0, 0);
  }, [siblingIds, loading, error, initialCommentId, initialIndex, resetToIndex]);

  // URL update on swipe — only after scroll position is initialized.
  // Uses scrollInitialized state (not ref) so it's batched with setCurrentIndex
  // and both take effect in the same render — preventing a stale currentIndex=0 navigation.
  // The ref check covers the render after an external navigation: the effect
  // above has just reset the ref, but this render's state still holds the old
  // siblings, and navigating to one of them would undo that navigation.
  useEffect(() => {
    if (!scrollInitialized || !hasInitializedScrollRef.current) return;
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

  // Save/restore scrollY for bfcache. In memory, not storage: bfcache keeps the
  // JS heap, and stored values can be blocked or expire.
  const scrollYOnHideRef = useRef(0);
  useEffect(() => {
    const handlePageHide = () => {
      scrollYOnHideRef.current = window.scrollY;
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.scrollTo(0, scrollYOnHideRef.current);
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  if (error && siblingIds.length <= 1 && giveUp) {
    return (
      <div className="swipe-snap-container" data-testid="swipe-container">
        <StateView variant="error" title="Failed to load comments" description={error} action={{ label: 'Retry', onClick: () => void retry().catch(() => { /* error state set internally */ }) }} className="swipe-state-center" />
      </div>
    );
  }

  const VIRTUALIZE_BUFFER = 2;

  // The shown panel and the swipe's next stops each way.
  const windowIndexes = new Set([shownIndex]);
  for (const step of [-1, 1]) {
    let stops = 0;
    for (let index = shownIndex + step; stops < VIRTUALIZE_BUFFER && index >= 0 && index < siblingIds.length; index += step) {
      if (isSkipped(index)) continue;
      windowIndexes.add(index);
      stops++;
    }
  }

  // One container for the opening comment and the full list, and panels keyed
  // by id, so the comment on screen isn't mounted again when its siblings land.
  return (
    <div
      ref={containerRef}
      className="swipe-snap-container"
      data-testid="swipe-container"
    >
      {siblingIds.map((id, index) => {
        const isWithinWindow = windowIndexes.has(index);

        return (
          <div
            key={id}
            className={isOpening ? 'swipe-snap-panel active' : 'swipe-snap-panel'}
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

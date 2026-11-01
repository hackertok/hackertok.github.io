import { useEffect, useRef, useLayoutEffect } from 'react';
import { InfiniteStoryListPage } from '../components';
import { useInfiniteStories } from '../hooks/useInfiniteStories';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { FEED_TYPE_TITLES } from '../config/feedTypes';
import type { FeedType } from '../types';

export function StoryList({ type }: { type: FeedType }) {
  useDocumentTitle(FEED_TYPE_TITLES[type]);

  const {
    stories,
    loading,
    error,
    hasMore,
    loadMore,
    isFromCache,
    isFromSession,
    initialScrollY,
    saveSessionState,
  } = useInfiniteStories(type);

  // `type` must not change for a mounted list: the feed routes key it by type.
  const hasRestoredScroll = useRef(false);

  // Restore scroll BEFORE paint so the user doesn't see a flash of
  // top-of-page on back-nav.
  useLayoutEffect(() => {
    if (isFromSession && initialScrollY > 0 && !hasRestoredScroll.current && stories.length > 0) {
      hasRestoredScroll.current = true;
      requestAnimationFrame(() => {
        window.scrollTo(0, initialScrollY);
      });
    } else if (!isFromSession && !hasRestoredScroll.current) {
      // Fresh nav (e.g., logo click) — scroll to top.
      hasRestoredScroll.current = true;
      window.scrollTo(0, 0);
    }
  }, [isFromSession, initialScrollY, stories.length]);

  useEffect(() => {
    if (isFromSession) return; // Don't refetch on back navigation.

    // The `!error` guard prevents an infinite retry loop: without it,
    // loadMore() sets loading→true then error→msg then loading→false,
    // which re-triggers this effect and loops.
    if ((stories.length === 0 || isFromCache) && !loading && !error) {
      void loadMore().catch(() => { /* error state set internally */ });
    }
  }, [stories.length, loading, loadMore, isFromCache, isFromSession, error]);

  return (
    <InfiniteStoryListPage
      result={{ stories, loading, error, hasMore, loadMore }}
      resetKey={type}
      storyCardExtras={{ listType: type, onBeforeNavigate: saveSessionState }}
    />
  );
}

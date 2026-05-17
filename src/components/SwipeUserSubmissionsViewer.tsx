import { useMemo } from 'react';
import {
  useUserInfiniteStories,
  formatNoUserSubmissionsTitle,
} from '../hooks/useUserInfiniteStories';
import { SwipeStoryViewerCore } from './SwipeStoryViewer';

interface SwipeUserSubmissionsViewerProps {
  /** HN username, case-preserved. Firebase and Algolia treat this as case-sensitive. */
  username: string;
  /**
   * Numeric story ID to anchor on (set by `MobileItemDetailWrapper` when the
   * route is `/item/:id` with `state.fromUser`). Must NOT be set for the bare
   * `/submitted/:id` route — `id` there is the username, and a non-numeric
   * `initialItemId` would `Number()` to `NaN`, triggering a wasteful injected
   * fetch and blocking the empty-state UI from rendering.
   */
  initialItemId?: string;
}

/** User-submissions swipe viewer for mobile. */
export function SwipeUserSubmissionsViewer({
  username,
  initialItemId,
}: SwipeUserSubmissionsViewerProps) {
  const { stories, loading, error, hasMore, loadMore } = useUserInfiniteStories(username);

  const backState = useMemo(() => ({ fromUser: username }), [username]);

  return (
    <SwipeStoryViewerCore
      stories={stories}
      loading={loading}
      error={error}
      hasMore={hasMore}
      loadMore={loadMore}
      initialItemId={initialItemId}
      backState={backState}
      titleFallback={`Submissions by ${username}`}
      emptyTitle={formatNoUserSubmissionsTitle(username)}
    />
  );
}

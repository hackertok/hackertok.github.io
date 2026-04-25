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

/**
 * User-submissions swipe viewer for mobile. Thin wrapper over
 * {@link SwipeStoryViewerCore} that sources data from
 * `useUserInfiniteStories(username)`.
 *
 * Used on mobile for `/submitted/:id` and for `/item/:id` arrivals whose
 * `location.state` carries `fromUser`.
 *
 * `backHref` points back to the list (`/submitted/:username`), not the
 * profile (`/user/:username`), matching the convention used by every other
 * swipe viewer (return to the list you came from). The user can navigate to
 * the profile from the list page.
 */
export function SwipeUserSubmissionsViewer({
  username,
  initialItemId,
}: SwipeUserSubmissionsViewerProps) {
  const { stories, loading, error, hasMore, loadMore } = useUserInfiniteStories(username);

  // Stable identity so SwipeStoryViewerCore's URL-sync effect doesn't re-run
  // on every parent re-render.
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
      backHref={`/submitted/${username}`}
      titleFallback={`Submissions by ${username}`}
      emptyTitle={formatNoUserSubmissionsTitle(username)}
    />
  );
}

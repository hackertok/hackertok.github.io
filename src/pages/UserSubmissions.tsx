import { useParams } from 'react-router-dom';
import { InfiniteStoryListPage, StateView } from '../components';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useScrollRestore } from '../hooks/useScrollRestore';
import {
  useUserInfiniteStories,
  formatNoUserSubmissionsTitle,
} from '../hooks/useUserInfiniteStories';

export function UserSubmissions() {
  const { id } = useParams<{ id: string }>();
  const username = id ?? '';

  // HN's `/submitted?id=USER` is stories-only despite the misleading
  // "submitted" label (which includes comments on Firebase). Title
  // and empty state agree on this wording so the desktop list and
  // the swipe viewer read identically.
  useDocumentTitle(username ? `Submissions by ${username}` : undefined);

  const result = useUserInfiniteStories(username);

  // Scroll restore key includes the username so each user's submission
  // page restores independently.
  const { saveScrollPosition } = useScrollRestore(
    username ? `user:${username}` : undefined,
    result.stories.length > 0,
  );

  if (!username) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="not-found"
          title="No user specified"
          action={{ label: 'Return to Home', to: '/' }}
        />
      </div>
    );
  }

  return (
    <InfiniteStoryListPage
      result={result}
      resetKey={username}
      storyCardExtras={{ fromUser: username, onBeforeNavigate: saveScrollPosition }}
      emptyTitle={formatNoUserSubmissionsTitle(username)}
      failTitle="Failed to load submissions"
    />
  );
}

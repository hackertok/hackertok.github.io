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

  useDocumentTitle(username ? `Submissions by ${username}` : undefined);

  const result = useUserInfiniteStories(username);

  // Keyed by username so each user restores independently.
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
          action={{ label: 'Back to Home', to: '/' }}
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

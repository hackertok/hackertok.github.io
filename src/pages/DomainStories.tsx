import { useParams } from 'react-router-dom';
import { InfiniteStoryListPage, StateView } from '../components';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useScrollRestore } from '../hooks/useScrollRestore';
import {
  useDomainInfiniteStories,
  canonicalizeDomain,
  formatNoSubmissionsTitle,
} from '../hooks/useDomainInfiniteStories';

export function DomainStories() {
  // Wildcard param captures paths like `github.com/foo`.
  const params = useParams();
  const rawDomain = params['*'] ?? '';
  // Canonicalize so title, empty state, and state.fromDomain all share one key.
  const domain = canonicalizeDomain(rawDomain);

  useDocumentTitle(domain ? `Submissions from ${domain}` : undefined);

  const result = useDomainInfiniteStories(domain);

  // Keyed by domain so each domain restores independently.
  const { saveScrollPosition } = useScrollRestore(
    domain ? `domain:${domain}` : undefined,
    result.stories.length > 0,
  );

  if (!domain) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="not-found"
          title="No domain specified"
          action={{ label: 'Back to Home', to: '/' }}
        />
      </div>
    );
  }

  return (
    <InfiniteStoryListPage
      result={result}
      resetKey={domain}
      storyCardExtras={{ fromDomain: domain, onBeforeNavigate: saveScrollPosition }}
      emptyTitle={formatNoSubmissionsTitle(domain)}
    />
  );
}

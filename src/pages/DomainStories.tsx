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
  // Canonicalize so the title, empty state, and the `fromDomain` prop
  // propagated into `location.state` all agree with the hook's cache
  // key — otherwise `/from/WWW.Foo.com` would write a non-canonical
  // `state.fromDomain` and back-nav would land on a non-canonical URL.
  const domain = canonicalizeDomain(rawDomain);

  useDocumentTitle(domain ? `Submissions from ${domain}` : undefined);

  const result = useDomainInfiniteStories(domain);

  // Scroll restore key includes the canonical domain so each domain's
  // scroll position is independent (`/from/github.com` and
  // `/from/foo.bar` don't fight over the same slot).
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
          action={{ label: 'Return to Home', to: '/' }}
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

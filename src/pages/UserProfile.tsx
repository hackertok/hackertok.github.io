import { useLayoutEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Award, Calendar, FileText } from 'lucide-react';
import { useUserProfile } from '../hooks/useUserProfile';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useScrollContainer } from '../hooks/useScrollContainer';
import { sanitizeHtml } from '../utils/sanitize';
import { formatAbsoluteDate, formatTimeAgo, safeISOString } from '../api/hn';
import { StateView, PageStage } from '../components';
import { metaItemClass, metaPillClass } from '../lib/classes';

/** Header-only skeleton — about text is optional so no about placeholder. */
function UserProfileSkeleton() {
  return (
    <div className="animate-pulse">
      <header className="mb-6 pb-4 border-b border-border">
        <div className="h-7 bg-skeleton rounded w-40 mb-2" />

        {/* karma / date / submissions */}
        <div className="flex items-center gap-x-3.5 gap-y-2 min-h-5">
          <div className="h-3 bg-skeleton rounded w-24" />
          <div className="h-3 bg-skeleton rounded w-32" />
          <div className="h-3 bg-skeleton rounded w-24" />
        </div>
      </header>
    </div>
  );
}

export function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const username = id ?? '';

  const { profile, loading, error, isNotFound, refresh } = useUserProfile(username);

  const { disableSwipeMode } = useScrollContainer();

  // index.html optimistically applies `swipe-mode` to <html>/<body>
  // for any `#/...` route on mobile so swipe viewers don't double-
  // paint a scrollable page first. This page IS vertically scrollable,
  // so we undo that on mount or `overflow: clip` sticks on direct
  // load (`https://.../#/user/pg`). Desktop is a no-op via the
  // provider's noop fallback.
  //
  // useLayoutEffect (not useEffect): the class removal MUST run before
  // first paint to avoid a one-frame window where mid-flick gestures
  // are lost on direct mobile load. Mirrors `useSwipeScroll`, which
  // uses useLayoutEffect for the enable case.
  useLayoutEffect(() => {
    disableSwipeMode();
  }, [disableSwipeMode]);

  const documentTitle = !username || isNotFound
    ? 'User not found'
    : error
      ? 'Failed to load user'
      : profile
        ? profile.id
        : undefined;
  useDocumentTitle(documentTitle);

  const aboutHtml = profile?.about;
  const sanitizedAbout = useMemo(
    () => (aboutHtml ? sanitizeHtml(aboutHtml) : ''),
    [aboutHtml],
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

  // Error / not-found short-circuits run BEFORE PageStage because
  // they replace the whole layout (no skeleton overlay).

  if (isNotFound) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="not-found"
          title="User not found"
          description={`No user with the id "${username}" exists.`}
          action={{ label: 'Back to Home', to: '/' }}
        />
      </div>
    );
  }

  // Gate on `!loading` so this branch doesn't fire during the
  // skeleton phase.
  if (!loading && (error || !profile)) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="error"
          title="Failed to load user"
          description={error ?? undefined}
          action={{ label: 'Try Again', onClick: () => void refresh() }}
        />
      </div>
    );
  }

  const createdAtMs = profile ? profile.created * 1000 : 0;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      {/* `loading={loading && !profile}` so a refresh with a cached
          profile doesn't blank it out — the existing header stays up
          while the new fetch resolves. */}
      <PageStage
        loading={loading && !profile}
        skeleton={<UserProfileSkeleton />}
      >
        {profile && (
          <article className="story-stage-leader">
            <header className="mb-6 pb-4 border-b border-border">
              <h1 className="text-2xl font-semibold text-foreground mb-2">{profile.id}</h1>
              {/* Absolute date visible; relative on hover via <time title>. */}
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-muted-foreground">
                <span className={metaItemClass}>
                  <Award aria-hidden className="size-3.5" />
                  <span>{profile.karma.toLocaleString()} karma</span>
                </span>

                <span className={metaItemClass}>
                  <Calendar aria-hidden className="size-3.5" />
                  <time
                    dateTime={safeISOString(createdAtMs)}
                    title={formatTimeAgo(createdAtMs)}
                  >
                    {formatAbsoluteDate(createdAtMs)}
                  </time>
                </span>

                <Link
                  to={`/submitted/${profile.id}`}
                  className={`${metaPillClass} capitalize`}
                >
                  <FileText aria-hidden className="size-3.5" />
                  submissions
                </Link>
              </div>
            </header>

            {sanitizedAbout && (
              <section className="mb-6">
                <div
                  className="comment-content text-foreground text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: sanitizedAbout }}
                />
              </section>
            )}
          </article>
        )}
      </PageStage>
    </div>
  );
}

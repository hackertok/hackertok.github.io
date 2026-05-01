import { useLayoutEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Award, Calendar, FileText } from 'lucide-react';
import { useUserProfile } from '../hooks/useUserProfile';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useScrollContainer } from '../hooks/useScrollContainer';
import { sanitizeHtml } from '../utils/sanitize';
import { formatAbsoluteDate, formatTimeAgo, safeISOString } from '../api/hn';
import { StateView, Spinner } from '../components';
import { metaItemClass, metaPillClass } from '../lib/classes';

export function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const username = id ?? '';

  const { profile, loading, error, isNotFound, refresh } = useUserProfile(username);

  const { disableSwipeMode } = useScrollContainer();

  // index.html optimistically applies the `swipe-mode` class to <html>/<body>
  // for any `#/...` route on mobile so the swipe viewers don't double-paint
  // a scrollable page first. This page is vertically scrollable, so we have
  // to undo that on mount or the body stays `overflow: hidden` on direct
  // load (`https://.../#/user/pg`). The provider's noop fallback on desktop
  // makes this a safe no-op there.
  //
  // useLayoutEffect (not useEffect): the class removal must run BEFORE the
  // first paint so the user never sees a non-scrollable frame on direct mobile
  // load. With useEffect the sequence is commit → paint (overflow:hidden still
  // active) → effect → repaint, leaving a one-frame window where mid-flick
  // gestures can be lost. useLayoutEffect collapses this to commit → effect →
  // paint. Mirrors `useSwipeScroll`, which uses useLayoutEffect for the
  // mirror-image enable case.
  useLayoutEffect(() => {
    disableSwipeMode();
  }, [disableSwipeMode]);

  // State-aware title mirrors `ItemDetail`. On error we still want a
  // descriptive title so browser history / tab labels read sensibly.
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
          action={{ label: 'Return to Home', to: '/' }}
        />
      </div>
    );
  }

  if (loading && !profile) {
    return (
      <div className="page-state-center-padded">
        <Spinner />
      </div>
    );
  }

  if (isNotFound) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="not-found"
          title="User not found"
          description={`No user with the id "${username}" exists.`}
          action={{ label: 'Return to Home', to: '/' }}
        />
      </div>
    );
  }

  if (error || !profile) {
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

  const createdAtMs = profile.created * 1000;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      <article>
        <header className="mb-6 pb-4 border-b border-border">
          <h1 className="text-2xl font-semibold text-foreground mb-2">{profile.id}</h1>
          {/* Stat row — flex with leading icons, NO pipe separators (gap only).
              Visible date is absolute (`October 9, 2006`) via `formatAbsoluteDate`;
              the relative `X years ago` lives in the `<time title>` attribute so
              users get both views — the visible primary, the hover surfaces age.
              Submissions link uses CSS `capitalize` so DOM textContent stays
              lowercase `submissions` (preserves accessible-name assertions). */}
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

            {/* Submissions: nav-pill hover pattern (see `src/lib/classes.ts`
                for the full rationale on the negative-margin trick + axe
                compliance via font-medium weight delta). */}
            <Link
              to={`/submitted/${profile.id}`}
              className={`${metaPillClass} capitalize font-medium`}
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
    </div>
  );
}

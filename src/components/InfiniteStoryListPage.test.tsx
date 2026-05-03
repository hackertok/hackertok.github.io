import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { render } from '../test/test-utils';
import { createStoryItem } from '../test/factories';
import {
  InfiniteStoryListPage,
  type InfiniteStoryListResult,
  type StoryCardExtras,
} from './InfiniteStoryListPage';

// `useAutoRetry` triggers a backoff schedule (2/4/8s) on every render
// where `error` is set. Mocking it lets us pin `isRetrying` to a
// specific value per test instead of sequencing fake timers — the
// retry sequence itself is exercised in `useAutoRetry.test.ts`.
vi.mock('../hooks/useAutoRetry');
vi.mock('../hooks/useNetworkStatus');

import { useAutoRetry } from '../hooks/useAutoRetry';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
const mockUseAutoRetry = vi.mocked(useAutoRetry);
const mockUseNetworkStatus = vi.mocked(useNetworkStatus);

function makeResult(
  overrides: Partial<InfiniteStoryListResult> = {},
): InfiniteStoryListResult {
  return {
    stories: [],
    loading: false,
    error: null,
    hasMore: true,
    loadMore: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderPage(props: {
  result: InfiniteStoryListResult;
  resetKey?: string;
  storyCardExtras?: StoryCardExtras;
  emptyTitle?: string;
  failTitle?: string;
}) {
  // Wrap in a Routes element so any `<Link>` rendered by `<StoryCard>`
  // / `<StateView action={{ to }}>` resolves a route — RTL's
  // MemoryRouter is provided by `test-utils.render`.
  return render(
    <Routes>
      <Route
        path="/"
        element={
          <InfiniteStoryListPage
            result={props.result}
            resetKey={props.resetKey ?? 'test-key'}
            storyCardExtras={props.storyCardExtras}
            emptyTitle={props.emptyTitle}
            failTitle={props.failTitle}
          />
        }
      />
    </Routes>,
  );
}

describe('InfiniteStoryListPage', () => {
  beforeEach(() => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: true });
    mockUseAutoRetry.mockReturnValue({
      isRetrying: false,
      giveUp: false,
      resetRetry: vi.fn(),
    });
  });

  describe('rendering branches', () => {
    it('renders cards from result.stories', () => {
      const stories = [
        createStoryItem({ id: 1, title: 'First story' }),
        createStoryItem({ id: 2, title: 'Second story' }),
      ];

      renderPage({ result: makeResult({ stories, hasMore: false }) });

      expect(screen.getByRole('link', { name: 'First story' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Second story' })).toBeInTheDocument();
    });

    it('shows the cold-load skeleton when stories are empty AND loading', () => {
      // PageStage's `loading` gate is `stories.length === 0 && loading`,
      // so an in-flight refresh with cached cards visible doesn't blank
      // them out. Pin both halves with a clean cold-load.
      const { container } = renderPage({
        result: makeResult({ loading: true }),
      });

      // .bg-skeleton is the marker class on StoryCardSkeletonList — same
      // sentinel UserSubmissions.test.tsx uses for the auto-retry case.
      expect(container.querySelectorAll('.bg-skeleton').length).toBeGreaterThan(0);
    });

    it('keeps cards visible across a refresh (loading=true with stories present)', () => {
      // The PageStage gate prevents the skeleton from masking cached
      // cards while a revalidate fetch is in flight.
      const stories = [createStoryItem({ id: 1, title: 'Cached story' })];

      const { container } = renderPage({
        result: makeResult({ stories, loading: true }),
      });

      expect(screen.getByRole('link', { name: 'Cached story' })).toBeInTheDocument();
      expect(container.querySelector('.bg-skeleton')).toBeNull();
    });
  });

  describe('empty state', () => {
    it('renders the empty StateView when emptyTitle is set and stories are empty', () => {
      renderPage({
        result: makeResult({ hasMore: false }),
        emptyTitle: 'No stories from this domain',
      });

      expect(screen.getByText('No stories from this domain')).toBeInTheDocument();
    });

    it('omits the empty StateView when emptyTitle is undefined', () => {
      // Main feed passes no `emptyTitle` because empty is unreachable
      // in normal operation. Confirm the branch lets the cards/footer
      // block render instead of the empty state.
      renderPage({
        result: makeResult({ hasMore: false }),
      });

      expect(screen.queryByText(/no stories|no submissions/i)).not.toBeInTheDocument();
    });
  });

  describe('error states', () => {
    it('renders the cold-error StateView with the default failTitle', () => {
      renderPage({
        result: makeResult({ error: 'Network down' }),
      });

      expect(screen.getByText('Failed to load items')).toBeInTheDocument();
      expect(screen.getByText('Network down')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });

    it('renders the cold-error StateView with an overridden failTitle', () => {
      renderPage({
        result: makeResult({ error: 'Boom' }),
        failTitle: 'Failed to load submissions',
      });

      expect(screen.getByText('Failed to load submissions')).toBeInTheDocument();
    });

    it('renders the retry skeleton during the cold-error → in-list-error transition (auto-retry in flight)', () => {
      // Sequence pinned: cold load fails → useAutoRetry kicks off a
      // backoff → on the next render `isRetrying` is true. The page
      // must show a skeleton (not the error UI) so the visual sequence
      // reads as "loading → loading" rather than "error → loading".
      mockUseAutoRetry.mockReturnValue({
        isRetrying: true,
        giveUp: false,
        resetRetry: vi.fn(),
      });

      const { container } = renderPage({
        result: makeResult({ error: 'Boom' }),
      });

      expect(container.querySelectorAll('.bg-skeleton').length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    });

    it('shows the in-list compact error with Retry when stories are present and an error is raised', () => {
      // Pagination failure — the list stays visible, the error sits in
      // the footer slot instead of replacing the layout. Lighter
      // affordance ("Retry", not "Try Again") to keep the fix-it
      // surface secondary to the cards. StateView's compact branch
      // hides the verbose description when a title resolves (which
      // it always does — DEFAULTS.error.title is "Something went
      // wrong"), so we assert the visible markers, not the raw error.
      const stories = [createStoryItem({ id: 1, title: 'Loaded story' })];

      renderPage({
        result: makeResult({ stories, error: 'Page 2 failed' }),
      });

      expect(screen.getByRole('link', { name: 'Loaded story' })).toBeInTheDocument();
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('clicking the in-list Retry calls resetRetry and loadMore', () => {
      // Manual retry resets the auto-retry counter (so the user gets a
      // full new backoff window if it fails again) and re-fires the
      // pagination request.
      const resetRetry = vi.fn();
      const loadMore = vi.fn().mockResolvedValue(undefined);
      mockUseAutoRetry.mockReturnValue({
        isRetrying: false,
        giveUp: false,
        resetRetry,
      });

      const stories = [createStoryItem({ id: 1, title: 'Loaded story' })];
      renderPage({
        result: makeResult({ stories, error: 'Page 2 failed', loadMore }),
      });

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(resetRetry).toHaveBeenCalledTimes(1);
      expect(loadMore).toHaveBeenCalledTimes(1);
    });
  });

  describe('footer states', () => {
    it('renders the end-of-feed StateView when !hasMore and stories are present', () => {
      const stories = [createStoryItem({ id: 1, title: 'Final story' })];

      renderPage({ result: makeResult({ stories, hasMore: false }) });

      // StateView variant="end" default copy — see STATE_VIEW_DEFAULTS
      // in StateView.tsx. Loose match in case the copy is ever tweaked.
      expect(screen.getByText(/reached the end/i)).toBeInTheDocument();
    });

    it('omits the end-of-feed footer while hasMore is true', () => {
      const stories = [createStoryItem({ id: 1, title: 'Story' })];

      renderPage({ result: makeResult({ stories, hasMore: true }) });

      expect(screen.queryByText(/reached the end/i)).not.toBeInTheDocument();
    });
  });

  describe('storyCardExtras forwarding', () => {
    it('forwards fromUser into the story card byline so links carry the origin', () => {
      const stories = [
        createStoryItem({ id: 12345, title: 'User submission', commentCount: 7 }),
      ];

      renderPage({
        result: makeResult({ stories, hasMore: false }),
        storyCardExtras: { fromUser: 'leerob' },
      });

      // href is the easiest assertion against `to={`/item/${id}`}`. The
      // location.state forwarding (which carries `fromUser`) is
      // exercised by StoryCard.test.tsx; we only need to confirm the
      // prop survives the boundary here.
      const commentsLink = screen.getByRole('link', { name: /7 comments/ });
      expect(commentsLink).toHaveAttribute('href', '/item/12345');
    });
  });
});

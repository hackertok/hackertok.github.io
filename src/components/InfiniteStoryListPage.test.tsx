import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { Routes, Route } from 'react-router';
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

      const title = screen.getByText('No stories from this domain');

      expect(title).toBeInTheDocument();
      expect(title.closest('.page-state-center-padded')).not.toBeNull();
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

      const title = screen.getByText('Failed to load items');

      expect(title).toBeInTheDocument();
      expect(screen.getByText('Network down')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
      expect(title.closest('.page-state-center-padded')).not.toBeNull();
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
      // surface secondary to the cards. It shows StateView's default
      // title, "Something went wrong", rather than the raw error.
      const stories = [createStoryItem({ id: 1, title: 'Loaded story' })];

      renderPage({
        result: makeResult({ stories, error: 'Page 2 failed' }),
      });

      expect(screen.getByRole('link', { name: 'Loaded story' })).toBeInTheDocument();
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      expect(screen.queryByText('Page 2 failed')).not.toBeInTheDocument();
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

  describe('load-more trigger', () => {
    // The shared mock never reports anything in view. This one reports the
    // end of the list in view once and never again, as in a background tab,
    // whose observer doesn't run.
    class InViewOnceObserver {
      readonly thresholds = [0];
      readonly root = null;
      readonly rootMargin = '';
      readonly scrollMargin = '';
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        if (target.tagName === 'ARTICLE') return; // story cards
        setTimeout(() => this.callback(
          [{ target, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        ), 0);
      }
      unobserve() { /* noop */ }
      disconnect() { /* noop */ }
      takeRecords() { return []; }
    }

    const VIEWPORT_HEIGHT = 800;
    const SharedObserver = globalThis.IntersectionObserver;
    beforeEach(() => {
      globalThis.IntersectionObserver = InViewOnceObserver;
      vi.stubGlobal('innerHeight', VIEWPORT_HEIGHT);
      vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT);
    });
    afterEach(() => {
      globalThis.IntersectionObserver = SharedObserver;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const rectAt = (top: number) =>
      ({ x: 0, y: top, top, left: 0, right: 0, bottom: top, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;

    // Each page is one story, and the third page is the last.
    function Feed({ onLoadMore, onPageLanded }: { onLoadMore: () => void; onPageLanded?: () => void }) {
      const [stories, setStories] = useState(() => [createStoryItem({ id: 1, title: 'Story 1' })]);
      const [loading, setLoading] = useState(false);
      const loadMore = useCallback(async () => {
        onLoadMore();
        setLoading(true);
        await new Promise(resolve => setTimeout(resolve, 10));
        onPageLanded?.();
        setStories(prev => [...prev, createStoryItem({ id: prev.length + 1, title: `Story ${prev.length + 1}` })]);
        setLoading(false);
      }, [onLoadMore, onPageLanded]);

      return (
        <InfiniteStoryListPage
          result={{ stories, loading, error: null, hasMore: stories.length < 4, loadMore }}
          resetKey="test-key"
        />
      );
    }

    function renderFeed(props: { onLoadMore: () => void; onPageLanded?: () => void }) {
      return render(
        <Routes>
          <Route path="/" element={<Feed {...props} />} />
        </Routes>,
      );
    }

    it('keeps loading pages while the end of the list stays in view', async () => {
      const onLoadMore = vi.fn();

      renderFeed({ onLoadMore });

      expect(await screen.findByRole('link', { name: 'Story 4' })).toBeInTheDocument();
      expect(onLoadMore).toHaveBeenCalledTimes(3);
    });

    it('stops once a page pushes the end of the list out of view, though the observer has not said so', async () => {
      const onLoadMore = vi.fn();
      const getRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');

      renderFeed({
        onLoadMore,
        onPageLanded: () => getRect.mockReturnValue(rectAt(VIEWPORT_HEIGHT + 1000)),
      });

      expect(await screen.findByRole('link', { name: 'Story 2' })).toBeInTheDocument();
      await act(() => new Promise(resolve => setTimeout(resolve, 50)));
      expect(onLoadMore).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('link', { name: 'Story 3' })).not.toBeInTheDocument();
    });

    it('keeps loading on an iPad zoomed in to the end of the list', async () => {
      // Zoomed in 2×, iPad Safari's innerHeight is the half of the layout
      // viewport on screen, here the bottom half, where the end of the list is.
      const onLoadMore = vi.fn();
      vi.stubGlobal('innerHeight', VIEWPORT_HEIGHT / 2);
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectAt(VIEWPORT_HEIGHT - 100));

      renderFeed({ onLoadMore });

      expect(await screen.findByRole('link', { name: 'Story 4' })).toBeInTheDocument();
      expect(onLoadMore).toHaveBeenCalledTimes(3);
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

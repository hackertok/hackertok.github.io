import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../test/test-utils';
import { SwipeStoryViewerCore } from './SwipeStoryViewer';
import { createStoryItem } from '../test/factories';
import {
  clearViewed,
  clearViewedTimes,
  clearSessionViewed,
  addToSessionViewed,
  VIEWED_DETAIL_TIMES_KEY,
} from '../utils/viewedItems';

// The panel wrapper (with data-item-id) is rendered by SwipeStoryViewerCore
// itself, so stub the heavy detail child to keep these tests focused on the
// mount-snapshot filtering and free of its data-fetching / async state.
vi.mock('./FullScreenItem', () => ({
  FullScreenItem: ({ itemId }: { itemId: number }) => <div data-testid="fsi">{itemId}</div>,
  FullScreenItemSkeletonPanel: () => <div data-testid="fsi-skeleton" />,
}));

Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  window.scrollTo = vi.fn();
});

describe('SwipeStoryViewerCore', () => {
  it('uses swipe-mode viewport centering for empty states', () => {
    render(
      <SwipeStoryViewerCore
        stories={[]}
        loading={false}
        error={null}
        hasMore={false}
        loadMore={vi.fn().mockResolvedValue(undefined)}
        backState={{ fromUser: 'levhawk' }}
        titleFallback="Submissions by levhawk"
        emptyTitle={'No submissions found by "levhawk"'}
      />,
    );

    const title = screen.getByRole('heading', {
      name: 'No submissions found by "levhawk"',
    });

    expect(title.closest('div')).toHaveClass('swipe-state-center');
  });
});

describe('SwipeStoryViewerCore — mount-snapshot filtering', () => {
  const baseProps = {
    loading: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn().mockResolvedValue(undefined),
    backState: { fromUser: 'test' },
  };

  beforeEach(() => {
    clearViewed();
    clearViewedTimes();
    clearSessionViewed();
  });

  // Seed the detail-times map directly: markViewedWithTime would also add the
  // id to the session set, which is the exact dimension under test here.
  function seedRecentlyViewed(ids: number[]) {
    const future = Date.now() + 10 * 60 * 60 * 1000; // inside the 12h window
    const map = Object.fromEntries(ids.map((id) => [String(id), future]));
    localStorage.setItem(VIEWED_DETAIL_TIMES_KEY, JSON.stringify(map));
  }

  function renderedPanelIds(): string[] {
    return screen
      .getAllByTestId('swipe-panel')
      .map((el) => el.getAttribute('data-item-id') ?? '');
  }

  it('keeps a recently-viewed story that was also viewed THIS session', () => {
    const stories = [
      createStoryItem({ id: 1, title: 'A' }),
      createStoryItem({ id: 2, title: 'B' }),
      createStoryItem({ id: 3, title: 'C' }),
    ];
    seedRecentlyViewed([1, 2]); // both still inside their hide window
    addToSessionViewed(1);      // ...but #1 was seen this session

    render(<SwipeStoryViewerCore {...baseProps} stories={stories} />);

    // #1 stays (session-exempt), #2 is filtered out, #3 was never viewed.
    expect(renderedPanelIds()).toEqual(['1', '3']);
  });

  it('falls back to the full list when every story is filtered out', () => {
    const stories = [
      createStoryItem({ id: 1, title: 'A' }),
      createStoryItem({ id: 2, title: 'B' }),
      createStoryItem({ id: 3, title: 'C' }),
    ];
    seedRecentlyViewed([1, 2, 3]); // all hidden, none seen this session

    render(<SwipeStoryViewerCore {...baseProps} stories={stories} />);

    // An empty feed is never shown — the fallback restores the full list.
    expect(renderedPanelIds()).toEqual(['1', '2', '3']);
  });
});
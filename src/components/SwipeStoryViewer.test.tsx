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
import { saveSwipePosition, readSwipePosition } from '../utils/swipePosition';
import { fetchItemOnly } from '../api/hn';
import type * as HnApi from '../api/hn';

// The panel wrapper (with data-item-id) is rendered by SwipeStoryViewerCore
// itself, so stub the heavy detail child to keep these tests focused on the
// mount-snapshot filtering and free of its data-fetching / async state.
vi.mock('./FullScreenItem', () => ({
  FullScreenItem: ({ itemId }: { itemId: number }) => <div data-testid="fsi">{itemId}</div>,
  FullScreenItemSkeletonPanel: () => <div data-testid="fsi-skeleton" />,
}));

// Spy on the out-of-feed injection fetch so restore tests can assert it is NOT
// triggered for a story already held in the snapshot. A never-resolving promise
// keeps it inert if it were ever (incorrectly) called.
vi.mock('../api/hn', async (importOriginal) => ({
  ...(await importOriginal<typeof HnApi>()),
  fetchItemOnly: vi.fn(() => new Promise(() => { /* never resolves */ })),
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

describe('SwipeStoryViewerCore — swipe-position restore', () => {
  const baseProps = {
    loading: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    clearViewed();
    clearViewedTimes();
    clearSessionViewed();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  function renderedPanelIds(): string[] {
    return screen
      .getAllByTestId('swipe-panel')
      .map((el) => el.getAttribute('data-item-id') ?? '');
  }

  it('restores a deep story at its prior index with neighbors (not collapsed to index 0)', () => {
    // Simulate a reload of a non-top feed: the live `stories` is empty (the
    // in-memory cache is wiped) but the durable snapshot holds the neighborhood.
    const restoredStories = Array.from({ length: 21 }, (_, i) => createStoryItem({ id: 100 + i }));
    saveSwipePosition({
      viewer: { from: 'best' },
      storyId: 110,
      index: 10,
      scrollY: 0,
      stories: restoredStories,
    });

    render(
      <SwipeStoryViewerCore {...baseProps} stories={[]} initialItemId="110" backState={{ from: 'best' }} />,
    );

    const ids = renderedPanelIds();
    // The whole restored neighborhood is present, in its original order...
    expect(ids).toEqual(restoredStories.map((s) => String(s.id)));
    // ...with the landed story at its restored index, NOT forced to index 0.
    expect(ids[10]).toBe('110');
    expect(ids[0]).toBe('100');
  });

  it('restores a deep position in feed order (front stories stay at the front, not pushed behind)', () => {
    // Regression for the reorder bug: the snapshot is saved from the FULL list the
    // user swiped (front → anchor), and after a reload the live feed comes back
    // restarting at the front. Prepending the snapshot must preserve feed order — the
    // live front-stories are dups that drop out, so nothing gets shoved behind the
    // anchor (previously a centered window stored only [anchor±R], pushing 0..anchor-R
    // after it).
    const fullList = Array.from({ length: 31 }, (_, i) => createStoryItem({ id: i }));
    saveSwipePosition({
      viewer: { from: 'top' },
      storyId: 25,
      index: 25,
      scrollY: 0,
      stories: fullList,
    });

    // After a reload the live feed restarts at page 0 (only the front of the list).
    const liveFront = Array.from({ length: 20 }, (_, i) => createStoryItem({ id: i }));

    render(
      <SwipeStoryViewerCore {...baseProps} stories={liveFront} initialItemId="25" backState={{ from: 'top' }} />,
    );

    const ids = renderedPanelIds().map(Number);
    // Strictly ascending from the front — no front block reordered past the anchor.
    expect(ids[0]).toBe(0);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    // The anchor sits at its true position, after the full front scrollback.
    expect(ids[25]).toBe(25);
  });

  it('does not re-fetch a restored story (no injection fetch / error screen)', () => {
    const restoredStories = Array.from({ length: 5 }, (_, i) => createStoryItem({ id: 200 + i }));
    saveSwipePosition({
      viewer: { from: 'top' },
      storyId: 202,
      index: 2,
      scrollY: 0,
      stories: restoredStories,
    });

    render(
      <SwipeStoryViewerCore {...baseProps} stories={[]} initialItemId="202" backState={{ from: 'top' }} />,
    );

    // The story is served from the snapshot, so the out-of-feed fetch is skipped
    // and the good list renders rather than the injected-error screen.
    expect(fetchItemOnly).not.toHaveBeenCalled();
    expect(screen.getByTestId('swipe-container')).toBeInTheDocument();
    expect(renderedPanelIds()).toContain('202');
  });

  it('ignores a snapshot saved by a different viewer (no false restore)', () => {
    // Snapshot was written in the domain viewer, but we mount the top feed.
    const restoredStories = Array.from({ length: 5 }, (_, i) => createStoryItem({ id: 300 + i }));
    saveSwipePosition({
      viewer: { fromDomain: 'example.com' },
      storyId: 302,
      index: 2,
      scrollY: 0,
      stories: restoredStories,
    });

    const liveStories = [
      createStoryItem({ id: 302, title: 'Live 302' }),
      createStoryItem({ id: 9, title: 'Other' }),
    ];

    render(
      <SwipeStoryViewerCore {...baseProps} stories={liveStories} initialItemId="302" backState={{ from: 'top' }} />,
    );

    // sameViewer fails (domain snapshot vs top feed) → not restoring → the
    // restored-only neighbors (300, 301, 303, 304) must NOT be seeded.
    const ids = renderedPanelIds();
    expect(ids).not.toContain('300');
    expect(ids).not.toContain('304');
  });

  it('regression: a fresh direct link with no snapshot still anchors the story to index 0', () => {
    // No snapshot in sessionStorage and no location.state → fresh shared link.
    const stories = [
      createStoryItem({ id: 1, title: 'A' }),
      createStoryItem({ id: 2, title: 'B' }),
      createStoryItem({ id: 3, title: 'C' }),
      createStoryItem({ id: 4, title: 'D' }),
    ];

    render(
      <SwipeStoryViewerCore {...baseProps} stories={stories} initialItemId="3" backState={{ from: 'top' }} />,
    );

    // Story #3 is anchored to index 0 — today's behavior, unchanged.
    expect(renderedPanelIds()[0]).toBe('3');
  });

  it('persists a snapshot of the current story when the page hides', () => {
    const stories = [
      createStoryItem({ id: 1, title: 'A' }),
      createStoryItem({ id: 2, title: 'B' }),
      createStoryItem({ id: 3, title: 'C' }),
    ];

    render(
      <SwipeStoryViewerCore {...baseProps} stories={stories} backState={{ from: 'top' }} />,
    );

    // Nothing is written until the page is actually hidden.
    expect(readSwipePosition()).toBeNull();

    window.dispatchEvent(new Event('pagehide'));

    const saved = readSwipePosition();
    expect(saved).not.toBeNull();
    expect(saved!.viewer).toEqual({ from: 'top' });
    // currentIndex is 0 (no anchor), so the landed story is the first one.
    expect(saved!.storyId).toBe(1);
    expect(saved!.stories.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('consumes (clears) the snapshot once the restore scroll is applied', () => {
    const restoredStories = Array.from({ length: 5 }, (_, i) => createStoryItem({ id: 400 + i }));
    saveSwipePosition({
      viewer: { from: 'top' },
      storyId: 402,
      index: 2,
      scrollY: 0,
      stories: restoredStories,
    });
    expect(readSwipePosition()).not.toBeNull();

    render(
      <SwipeStoryViewerCore {...baseProps} stories={[]} initialItemId="402" backState={{ from: 'top' }} />,
    );

    // scroll-init located the story and consumed the one-shot snapshot so a later
    // unrelated reload can't replay it.
    expect(readSwipePosition()).toBeNull();
  });

  it('falls back to the saved index (and still consumes) when the story id is not locatable', () => {
    // Drifted/corrupted snapshot: storyId is absent from the stored stories, so
    // findIndex(storyId) would miss. Written directly to break the normally
    // guaranteed storyId-in-stories invariant.
    const restoredStories = [
      createStoryItem({ id: 500 }),
      createStoryItem({ id: 501 }),
      createStoryItem({ id: 502 }),
    ];
    saveSwipePosition({
      viewer: { from: 'top' },
      storyId: 999,
      index: 1,
      scrollY: 0,
      stories: restoredStories,
    });

    render(
      <SwipeStoryViewerCore {...baseProps} stories={[]} initialItemId="999" backState={{ from: 'top' }} />,
    );

    // Without the index fallback findIndex(999) === -1 would skip the restore and
    // leave the snapshot intact; the fallback resolves the index and clears it.
    expect(readSwipePosition()).toBeNull();
  });

  it('dedupes the restored window against an overlapping live feed (restored order first, no dup ids)', () => {
    // Main-feed reload model: the live feed is rebuilt from the localStorage cache
    // and overlaps the restored window. Restored stories must come first, live-only
    // extras append after, and no id may appear twice (panels key on story.id, so a
    // duplicate id breaks rendering).
    const restoredStories = Array.from({ length: 5 }, (_, i) => createStoryItem({ id: 700 + i }));
    saveSwipePosition({
      viewer: { from: 'top' },
      storyId: 702,
      index: 2,
      scrollY: 0,
      stories: restoredStories,
    });

    // Live feed shares 700–702 (overlap) and adds one fresh id (800).
    const liveStories = [
      createStoryItem({ id: 700 }),
      createStoryItem({ id: 701 }),
      createStoryItem({ id: 702 }),
      createStoryItem({ id: 800 }),
    ];

    render(
      <SwipeStoryViewerCore {...baseProps} stories={liveStories} initialItemId="702" backState={{ from: 'top' }} />,
    );

    const ids = renderedPanelIds();
    expect(ids).toEqual(['700', '701', '702', '703', '704', '800']);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids[2]).toBe('702'); // restored story stays at its prior index
  });

  it('keeps restored neighbors that are in the recently-viewed hide set', () => {
    // Neighbors viewed in a prior (but still recent) session sit in the localStorage
    // hide set without being in the session set. The restored-id exemption must keep
    // them so the restored neighborhood does not collapse on reload.
    const restoredStories = Array.from({ length: 5 }, (_, i) => createStoryItem({ id: 600 + i }));
    saveSwipePosition({
      viewer: { from: 'top' },
      storyId: 602,
      index: 2,
      scrollY: 0,
      stories: restoredStories,
    });

    // Mark two restored neighbors as recently-viewed (localStorage hide window),
    // WITHOUT adding them to the session set — must be set before mount.
    const future = Date.now() + 10 * 60 * 60 * 1000;
    localStorage.setItem(
      VIEWED_DETAIL_TIMES_KEY,
      JSON.stringify({ '600': future, '601': future }),
    );

    render(
      <SwipeStoryViewerCore {...baseProps} stories={[]} initialItemId="602" backState={{ from: 'top' }} />,
    );

    // Without the exemption, 600 & 601 would be filtered out; they must remain.
    expect(renderedPanelIds()).toEqual(['600', '601', '602', '603', '604']);
  });

  it('restores the saved vertical scroll offset when consuming the snapshot', () => {
    const restoredStories = Array.from({ length: 5 }, (_, i) => createStoryItem({ id: 900 + i }));
    saveSwipePosition({
      viewer: { from: 'top' },
      storyId: 902,
      index: 2,
      scrollY: 240,
      stories: restoredStories,
    });

    render(
      <SwipeStoryViewerCore {...baseProps} stories={[]} initialItemId="902" backState={{ from: 'top' }} />,
    );

    expect(window.scrollTo).toHaveBeenCalledWith(0, 240);
  });

  it('persists a snapshot on visibilitychange → hidden', () => {
    const stories = [createStoryItem({ id: 1 }), createStoryItem({ id: 2 })];

    render(
      <SwipeStoryViewerCore {...baseProps} stories={stories} backState={{ from: 'top' }} />,
    );

    expect(readSwipePosition()).toBeNull();

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }

    const saved = readSwipePosition();
    expect(saved?.storyId).toBe(1);
    expect(saved?.viewer).toEqual({ from: 'top' });
  });
});
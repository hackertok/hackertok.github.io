import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Routes, Route, Link, useNavigate } from 'react-router';
import { render } from './test/test-utils';
import { MobileItemDetailWrapper, MobileStoryListWrapper } from './App';
import { fetchItemOnly } from './api/hn';
import { saveSwipePosition } from './utils/swipePosition';
import { createStoryItem } from './test/factories';
import type { LocationState, StoryItem } from './types';
import type * as HnApi from './api/hn';

// Force the mobile branch of the wrapper.
vi.mock('./hooks/useCanSwipe', () => ({ useCanSwipe: () => true }));

// Stub the heavy swipe viewers so we can assert *which* viewer the wrapper
// mounts (and with what props) without their data hooks / async state.
vi.mock('./components/SwipeStoryViewer', async () => {
  const { useState } = await import('react');
  return {
    SwipeStoryViewer: function SwipeStoryViewer({ type, initialItemId }: { type: string; initialItemId?: string }) {
      // Frozen at mount: a reused instance keeps the feed and item it was mounted for.
      const [mountedType] = useState(type);
      const [mountedItem] = useState(initialItemId ?? '');
      return (
        <div
          data-testid="feed-viewer"
          data-type={type}
          data-mounted-type={mountedType}
          data-item={initialItemId ?? ''}
          data-mounted-item={mountedItem}
        />
      );
    },
  };
});
vi.mock('./components/SwipeDomainStoryViewer', () => ({
  SwipeDomainStoryViewer: ({ domain, initialItemId }: { domain: string; initialItemId?: string }) => (
    <div data-testid="domain-viewer" data-domain={domain} data-item={initialItemId ?? ''} />
  ),
}));
vi.mock('./components/SwipeUserSubmissionsViewer', () => ({
  SwipeUserSubmissionsViewer: ({ username, initialItemId }: { username: string; initialItemId?: string }) => (
    <div data-testid="user-viewer" data-username={username} data-item={initialItemId ?? ''} />
  ),
}));

// The resolver fallback (Branch 5) calls fetchItemOnly; keep it pending so the
// resolver stays on its skeleton — a deterministic signal that we did NOT take
// the recovery branch, with no async state flip to await.
vi.mock('./api/hn', async (importOriginal) => ({
  ...(await importOriginal<typeof HnApi>()),
  fetchItemOnly: vi.fn(() => new Promise<never>(() => { /* never resolves */ })),
}));

function renderWrapper(id: number | string, state?: LocationState) {
  return render(
    <Routes>
      <Route path="/item/:id" element={<MobileItemDetailWrapper />} />
    </Routes>,
    { initialEntries: [{ pathname: `/item/${id}`, state }] },
  );
}

function seedSnapshot(viewer: LocationState, storyId: number) {
  const stories: StoryItem[] = [createStoryItem({ id: storyId })];
  saveSwipePosition({ viewer, storyId, index: 0, scrollY: 0, stories });
}

describe('MobileItemDetailWrapper — viewer recovery (stateless reload)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('recovers the originating feed viewer from a matching snapshot (not the top resolver)', () => {
    seedSnapshot({ from: 'best' }, 123);

    renderWrapper(123);

    const viewer = screen.getByTestId('feed-viewer');
    expect(viewer).toHaveAttribute('data-type', 'best');
    expect(viewer).toHaveAttribute('data-item', '123');
  });

  it('recovers SwipeDomainStoryViewer from a fromDomain snapshot', () => {
    seedSnapshot({ fromDomain: 'example.com' }, 123);

    renderWrapper(123);

    const viewer = screen.getByTestId('domain-viewer');
    expect(viewer).toHaveAttribute('data-domain', 'example.com');
    expect(viewer).toHaveAttribute('data-item', '123');
  });

  it('recovers SwipeUserSubmissionsViewer from a fromUser snapshot', () => {
    seedSnapshot({ fromUser: 'pg' }, 123);

    renderWrapper(123);

    const viewer = screen.getByTestId('user-viewer');
    expect(viewer).toHaveAttribute('data-username', 'pg');
    expect(viewer).toHaveAttribute('data-item', '123');
  });

  it('falls back to the resolver when there is no snapshot', () => {
    renderWrapper(123);

    // Resolver renders its own skeleton container while it classifies the item.
    expect(screen.getByTestId('swipe-container')).toBeInTheDocument();
    expect(screen.queryByTestId('feed-viewer')).toBeNull();
    expect(screen.queryByTestId('domain-viewer')).toBeNull();
    expect(screen.queryByTestId('user-viewer')).toBeNull();
  });

  it('recovers the viewer whose snapshot is on this story when another viewer saved later', () => {
    seedSnapshot({ from: 'best' }, 123);
    seedSnapshot({ from: 'top' }, 456);

    renderWrapper(123);

    expect(screen.getByTestId('feed-viewer')).toHaveAttribute('data-type', 'best');
  });

  it('falls back to the resolver when the snapshot id does not match the route', () => {
    seedSnapshot({ from: 'best' }, 999); // snapshot is for a different story

    renderWrapper(123);

    expect(screen.getByTestId('swipe-container')).toBeInTheDocument();
    expect(screen.queryByTestId('feed-viewer')).toBeNull();
  });

  it('prefers location.state over the snapshot (Branch 4 before 4b)', () => {
    seedSnapshot({ from: 'best' }, 123); // snapshot says best...

    renderWrapper(123, { from: 'top' }); // ...but the live route state says top

    expect(screen.getByTestId('feed-viewer')).toHaveAttribute('data-type', 'top');
  });

  it('falls through to the resolver when location.state names no viewer', () => {
    // state is present (so the Branch 2–4 block runs) but carries no
    // from/fromDomain/fromUser, so renderSwipeViewer returns null and the
    // wrapper must fall through to the resolver rather than mounting a viewer.
    renderWrapper(123, {});

    expect(screen.getByTestId('swipe-container')).toBeInTheDocument();
    expect(screen.queryByTestId('feed-viewer')).toBeNull();
    expect(screen.queryByTestId('domain-viewer')).toBeNull();
    expect(screen.queryByTestId('user-viewer')).toBeNull();
  });
});

describe('MobileItemDetailWrapper — direct link', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  function SwipeToNextStory() {
    const navigate = useNavigate();
    // What the swipe viewer does when the first swipe lands on the next story.
    return (
      <button onClick={() => void navigate('/item/12345', { replace: true, state: { from: 'top' } })}>
        swipe
      </button>
    );
  }

  it('keeps the story viewer when the first swipe adds `from: top` to the URL state', async () => {
    vi.mocked(fetchItemOnly).mockResolvedValueOnce(createStoryItem({ id: 88888 }));
    render(
      <Routes>
        <Route path="/item/:id" element={<><MobileItemDetailWrapper /><SwipeToNextStory /></>} />
      </Routes>,
      { initialEntries: ['/item/88888'] },
    );
    expect(await screen.findByTestId('feed-viewer')).toHaveAttribute('data-item', '88888');

    fireEvent.click(screen.getByRole('button', { name: 'swipe' }));

    // A new instance would start over from 12345 and lose 88888, the story
    // the link opened, which isn't in the Top feed.
    const viewer = screen.getByTestId('feed-viewer');
    expect(viewer).toHaveAttribute('data-item', '12345');
    expect(viewer).toHaveAttribute('data-mounted-item', '88888');
  });
});

describe('MobileItemDetailWrapper — ids that are not numbers', () => {
  it.each(['abc', '1.5', '-1'])('shows "Item not found" for /item/%s instead of a feed', (id) => {
    renderWrapper(id, { from: 'top' });

    expect(screen.getByRole('heading', { name: 'Item not found' })).toBeInTheDocument();
    expect(screen.queryByTestId('feed-viewer')).toBeNull();
    expect(screen.queryByTestId('swipe-container')).toBeNull();
    expect(document.title).toMatch(/^Item not found/);
  });
});

describe('MobileStoryListWrapper', () => {
  it('mounts a new viewer when you switch feeds before the URL moves to a story', () => {
    render(
      <>
        <Routes>
          <Route path="/" element={<MobileStoryListWrapper type="top" />} />
          <Route path="/best" element={<MobileStoryListWrapper type="best" />} />
        </Routes>
        <Link to="/best">best</Link>
      </>,
    );
    expect(screen.getByTestId('feed-viewer')).toHaveAttribute('data-mounted-type', 'top');

    fireEvent.click(screen.getByRole('link', { name: 'best' }));

    const viewer = screen.getByTestId('feed-viewer');
    expect(viewer).toHaveAttribute('data-type', 'best');
    expect(viewer).toHaveAttribute('data-mounted-type', 'best');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { render } from './test/test-utils';
import { MobileItemDetailWrapper } from './App';
import { saveSwipePosition } from './utils/swipePosition';
import { createStoryItem } from './test/factories';
import type { LocationState, StoryItem } from './types';
import type * as HnApi from './api/hn';

// Force the mobile branch of the wrapper.
vi.mock('./hooks/useIsMobile', () => ({ useIsMobile: () => true }));

// Stub the heavy swipe viewers so we can assert *which* viewer the wrapper
// mounts (and with what props) without their data hooks / async state.
vi.mock('./components/SwipeStoryViewer', () => ({
  SwipeStoryViewer: ({ type, initialItemId }: { type: string; initialItemId?: string }) => (
    <div data-testid="feed-viewer" data-type={type} data-item={initialItemId ?? ''} />
  ),
}));
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

function renderWrapper(id: number, state?: LocationState) {
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

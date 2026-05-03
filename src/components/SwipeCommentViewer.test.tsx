import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../test/test-utils';
import { SwipeCommentViewer } from './SwipeCommentViewer';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { ALGOLIA_API, FIREBASE_API } from '../config/api';

// SwipeCommentViewer uses window.innerWidth for scroll calculations.
// jsdom defaults to 0, so set a meaningful width for virtualization tests.
Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });

// jsdom doesn't implement Element.prototype.scrollTo
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
});

describe('SwipeCommentViewer', () => {
  afterEach(() => {
    server.resetHandlers();
  });

  it('renders swipe container with skeleton while loading', () => {
    render(<SwipeCommentViewer initialCommentId="1001" />, {
      initialEntries: [{ pathname: '/item/1001', state: { isComment: true } }],
    });

    const container = screen.getByTestId('swipe-container');
    expect(container).toBeInTheDocument();

    const panels = screen.getAllByTestId('swipe-panel');
    expect(panels.length).toBeGreaterThanOrEqual(1);
  });

  it('renders sibling comment panels after loading', async () => {
    render(<SwipeCommentViewer initialCommentId="1001" />, {
      initialEntries: [{ pathname: '/item/1001', state: { isComment: true } }],
    });

    // Parent 12345 has kids: [1001, 1002, 1003] → 3 panels.
    await waitFor(() => {
      const panels = screen.getAllByTestId('swipe-panel');
      expect(panels.length).toBe(3);
    });

    await waitFor(() => {
      expect(screen.getByText('patio11')).toBeInTheDocument();
    });
  });

  it('shows error state when Firebase fetch fails', async () => {
    server.use(
      http.get(`${FIREBASE_API}/item/:id.json`, () => {
        return HttpResponse.json(
          { status: 500, error: 'Server Error' },
          { status: 500 },
        );
      }),
    );

    render(<SwipeCommentViewer initialCommentId="999" />, {
      initialEntries: [{ pathname: '/item/999', state: { isComment: true } }],
    });

    // 30s waitFor + 35s test timeout cover the 2+4+8s auto-retry backoff.
    await waitFor(() => {
      expect(screen.getByText('Failed to load comments')).toBeInTheDocument();
    }, { timeout: 30000 });
  }, 35000);

  it('renders single panel when comment has no parent', async () => {
    server.use(
      http.get(`${FIREBASE_API}/item/:id.json`, ({ params }) => {
        const id = parseInt(params.id as string, 10);
        if (id === 7777) {
          return HttpResponse.json({
            id: 7777,
            by: 'solo',
            text: 'Top-level comment with no parent.',
            time: Math.floor(Date.now() / 1000) - 300,
            type: 'comment',
            // No parent → single-panel branch.
          });
        }
        return HttpResponse.json(null);
      }),
      // FullScreenComment's useCommentDetail hits Algolia.
      http.get(`${ALGOLIA_API}/items/:id`, () => {
        return HttpResponse.json({
          id: 7777,
          type: 'comment',
          author: 'solo',
          text: 'Top-level comment with no parent.',
          created_at_i: Math.floor(Date.now() / 1000) - 300,
          parent_id: null,
          story_id: null,
          children: [],
        });
      }),
    );

    render(<SwipeCommentViewer initialCommentId="7777" />, {
      initialEntries: [{ pathname: '/item/7777', state: { isComment: true } }],
    });

    await waitFor(() => {
      expect(screen.getByText('solo')).toBeInTheDocument();
    });

    const panels = screen.getAllByTestId('swipe-panel');
    expect(panels.length).toBe(1);
  });

  it('virtualizes panels beyond BUFFER distance', async () => {
    // 7 kids exercises the BUFFER=±2 boundary: 3 real, 4 skeleton.
    const manyKids = [3001, 3002, 3003, 3004, 3005, 3006, 3007];

    server.use(
      http.get(`${FIREBASE_API}/item/:id.json`, ({ params }) => {
        const id = parseInt(params.id as string, 10);
        if (id === 50000) {
          return HttpResponse.json({
            id: 50000,
            title: 'Big Thread',
            by: 'poster',
            type: 'story',
            kids: manyKids,
          });
        }
        return HttpResponse.json({
          id,
          by: `user${id}`,
          text: `Comment ${id}`,
          time: Math.floor(Date.now() / 1000) - 300,
          parent: 50000,
          type: 'comment',
        });
      }),
      http.get(`${ALGOLIA_API}/items/:id`, ({ params }) => {
        const id = parseInt(params.id as string, 10);
        return HttpResponse.json({
          id,
          type: 'comment',
          author: `user${id}`,
          text: `Comment ${id}`,
          created_at_i: Math.floor(Date.now() / 1000) - 300,
          parent_id: 50000,
          story_id: 50000,
          children: [],
        });
      }),
    );

    render(<SwipeCommentViewer initialCommentId="3001" />, {
      initialEntries: [{ pathname: '/item/3001', state: { isComment: true } }],
    });

    await waitFor(() => {
      const panels = screen.getAllByTestId('swipe-panel');
      expect(panels.length).toBe(7);
    });

    await waitFor(() => {
      expect(screen.getByText('user3001')).toBeInTheDocument();
    });

    // currentIndex=0 + BUFFER=2 → panels 0-2 real, 3-6 skeleton.
    const panels = screen.getAllByTestId('swipe-panel');
    // Panel 0 stays in PageStage's 'transitioning' state for ~1200ms
    // after loading flips false, so .skeleton-overlay lingers — wait
    // for it to unmount ('done' state) before asserting "fully cleared".
    await waitFor(
      () => {
        expect(panels[0].querySelector('.skeleton-overlay')).toBeNull();
      },
      { timeout: 2000 },
    );
    expect(panels[0].querySelector('.animate-pulse')).toBeNull();
    // Panel 3 sits exactly at distance BUFFER+1 — boundary check.
    expect(panels[3].querySelector('.animate-pulse')).not.toBeNull();
    expect(panels[4].querySelector('.animate-pulse')).not.toBeNull();
    expect(panels[5].querySelector('.animate-pulse')).not.toBeNull();
    expect(panels[6].querySelector('.animate-pulse')).not.toBeNull();
  });

  it('sets data-item-id on each panel', async () => {
    render(<SwipeCommentViewer initialCommentId="1001" />, {
      initialEntries: [{ pathname: '/item/1001', state: { isComment: true } }],
    });

    await waitFor(() => {
      const panels = screen.getAllByTestId('swipe-panel');
      expect(panels.length).toBe(3);
    });

    const panels = screen.getAllByTestId('swipe-panel');
    expect(panels[0]).toHaveAttribute('data-item-id', '1001');
    expect(panels[1]).toHaveAttribute('data-item-id', '1002');
    expect(panels[2]).toHaveAttribute('data-item-id', '1003');
  });
});

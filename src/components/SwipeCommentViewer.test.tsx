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

    // Should show at least one panel with skeleton content while loading
    const panels = screen.getAllByTestId('swipe-panel');
    expect(panels.length).toBeGreaterThanOrEqual(1);
  });

  it('renders sibling comment panels after loading', async () => {
    render(<SwipeCommentViewer initialCommentId="1001" />, {
      initialEntries: [{ pathname: '/item/1001', state: { isComment: true } }],
    });

    // Should eventually show all 3 sibling panels (parent 12345 has kids: [1001, 1002, 1003])
    await waitFor(() => {
      const panels = screen.getAllByTestId('swipe-panel');
      expect(panels.length).toBe(3);
    });

    // The first comment author should be rendered
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

    await waitFor(() => {
      expect(screen.getByText('Failed to load comments')).toBeInTheDocument();
    });
  });

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
            // No parent field
          });
        }
        return HttpResponse.json(null);
      }),
      // FullScreenComment's useCommentDetail fetches from Algolia
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

    // Only 1 panel since there are no siblings
    const panels = screen.getAllByTestId('swipe-panel');
    expect(panels.length).toBe(1);
  });

  it('virtualizes panels beyond BUFFER distance', async () => {
    // Create a parent with 7 kids to test virtualization (buffer = ±2)
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
      // FullScreenComment's useCommentDetail fetches from Algolia
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

    // Wait for all 7 panels to render
    await waitFor(() => {
      const panels = screen.getAllByTestId('swipe-panel');
      expect(panels.length).toBe(7);
    });

    // Wait for first panel's real content to load (author "user3001")
    await waitFor(() => {
      expect(screen.getByText('user3001')).toBeInTheDocument();
    });

    // With currentIndex=0 and BUFFER=2, panels 0-2 should be real content,
    // panels 3-6 should be skeleton placeholders.
    const panels = screen.getAllByTestId('swipe-panel');
    // Panel 0 (index 0, distance 0) - should have loaded real content
    expect(panels[0].querySelector('.animate-pulse')).toBeNull();
    // Panel 3 (distance = 3, just outside BUFFER=2) - exact boundary, should be skeleton
    expect(panels[3].querySelector('.animate-pulse')).not.toBeNull();
    // Panel 4+ (distance >= 4, well beyond buffer) - skeleton
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

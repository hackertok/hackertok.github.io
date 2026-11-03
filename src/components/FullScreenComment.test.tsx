import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../test/test-utils';
import { FullScreenComment } from './FullScreenComment';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { ALGOLIA_API } from '../config/api';
import { hnSdk } from '../api/hnSdk';
import { __resetFetchCachesForTests } from '../api/hn';
import type { FirebaseItem } from '../types';

const mockItem: FirebaseItem = {
  id: 12345,
  title: 'Rust Is the Future of JavaScript Infrastructure',
  url: 'https://leerob.io/blog/rust',
  by: 'leerob',
  score: 284,
  time: Math.floor(Date.now() / 1000) - 3600,
  descendants: 137,
  kids: [1001, 1002, 1003, 1004],
  type: 'story',
};

describe('FullScreenComment', () => {
  beforeEach(() => {
    __resetFetchCachesForTests();
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 12345) return mockItem;
      return null;
    });
  });

  afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
  });

  it('renders comment author and text', async () => {
    render(<FullScreenComment commentId={1001} />);

    await waitFor(() => {
      expect(screen.getByText('patio11')).toBeInTheDocument();
    });

    expect(screen.getByText(/wasm-bindgen/i)).toBeInTheDocument();
  });

  it('renders parent link', async () => {
    render(<FullScreenComment commentId={1001} />);

    const parentLink = await screen.findByRole('link', { name: 'parent' });
    expect(parentLink).toBeInTheDocument();
    expect(parentLink).toHaveAttribute('href', '/item/12345');
  });

  it('renders item title link after background fetch', async () => {
    render(<FullScreenComment commentId={1001} />);

    await waitFor(() => {
      expect(screen.getByText('Rust Is the Future of JavaScript Infrastructure')).toBeInTheDocument();
    });

    const itemLink = screen.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
    expect(itemLink).toHaveAttribute('href', '/item/12345');
  });

  it('renders replies', async () => {
    render(<FullScreenComment commentId={1001} />);

    await waitFor(() => {
      expect(screen.getByText('tptacek')).toBeInTheDocument();
    });

    expect(screen.getByText(/DX improvements/i)).toBeInTheDocument();
  });

  it('shows skeleton while loading', () => {
    render(<FullScreenComment commentId={1001} />);

    const skeleton = document.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    server.use(
      http.get(`${ALGOLIA_API}/items/:id`, () => {
        return HttpResponse.json(
          { status: 404, error: 'Item not found' },
          { status: 404 },
        );
      }),
    );

    render(<FullScreenComment commentId={999999} />);

    // 30s waitFor + 35s test timeout cover the 2+4+8s auto-retry backoff.
    await waitFor(() => {
      expect(screen.getByText('Failed to load comment')).toBeInTheDocument();
    }, { timeout: 30000 });
  }, 35000);

  it('shows deleted state for comment with no author or text', async () => {
    server.use(
      http.get(`${ALGOLIA_API}/items/:id`, () => {
        return HttpResponse.json({
          id: 5555,
          type: 'comment',
          author: null,
          text: null,
          created_at_i: Math.floor(Date.now() / 1000) - 600,
          parent_id: 12345,
          story_id: 12345,
          children: [],
        });
      }),
    );

    render(<FullScreenComment commentId={5555} />);

    await waitFor(() => {
      expect(screen.getByText('Comment deleted')).toBeInTheDocument();
    });
  });

  describe('a comment Algolia 404s', () => {
    const now = Math.floor(Date.now() / 1000);

    function mockMissingFromAlgolia(commentId: number, firebase: FirebaseItem, replies: object[] = []) {
      server.use(
        http.get(`${ALGOLIA_API}/items/:id`, ({ params }) => {
          const reply = replies.find(r => (r as { id: number }).id === Number(params.id));
          return reply ? HttpResponse.json(reply) : HttpResponse.json({ status: 404 }, { status: 404 });
        }),
      );
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === 12345) return mockItem;
        return Number(id) === commentId ? firebase : null;
      });
    }

    it('shows a flagged comment from Firebase with its replies', async () => {
      mockMissingFromAlgolia(
        7777,
        { id: 7777, type: 'comment', by: 'flaggeduser', text: '[flagged]', dead: true, parent: 12345, kids: [7778], time: now - 600 },
        [{ id: 7778, type: 'comment', author: 'dang', text: 'Please don&#x27;t.', created_at_i: now - 300, parent_id: 7777, story_id: 12345, children: [] }],
      );

      render(<FullScreenComment commentId={7777} />);

      expect(await screen.findByText('[flagged]')).toBeInTheDocument();
      expect(screen.getByText('flaggeduser')).toBeInTheDocument();
      expect(screen.getByText('dang')).toBeInTheDocument();
      expect(screen.getByText("Please don't.")).toBeInTheDocument();
      expect(await screen.findByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' })).toHaveAttribute('href', '/item/12345');
      expect(screen.queryByText('Failed to load comment')).not.toBeInTheDocument();
    });

    it('shows [flagged] for a killed comment whose text Firebase still has', async () => {
      mockMissingFromAlgolia(7777, { id: 7777, type: 'comment', by: 'flaggeduser', text: 'Praise the iLord.', dead: true, parent: 12345, time: now - 600 });

      render(<FullScreenComment commentId={7777} />);

      expect(await screen.findByText('[flagged]')).toBeInTheDocument();
      expect(screen.queryByText('Praise the iLord.')).not.toBeInTheDocument();
    });

    it('shows a deleted comment as deleted', async () => {
      mockMissingFromAlgolia(8888, { id: 8888, type: 'comment', deleted: true, parent: 12345, time: now - 600 });

      render(<FullScreenComment commentId={8888} />);

      expect(await screen.findByText('Comment deleted')).toBeInTheDocument();
      expect(screen.queryByText('Failed to load comment')).not.toBeInTheDocument();
    });
  });

  it('shows "No replies yet" for comment with no children', async () => {
    server.use(
      http.get(`${ALGOLIA_API}/items/:id`, () => {
        return HttpResponse.json({
          id: 6666,
          type: 'comment',
          author: 'leafnode',
          text: 'A comment with zero replies.',
          created_at_i: Math.floor(Date.now() / 1000) - 300,
          parent_id: 12345,
          story_id: 12345,
          children: [],
        });
      }),
    );

    render(<FullScreenComment commentId={6666} />);

    await waitFor(() => {
      expect(screen.getByText('No replies yet.')).toBeInTheDocument();
    });
  });

  it('keeps the replies skeleton, not "No replies yet.", until a flagged only reply loads', async () => {
    const now = Math.floor(Date.now() / 1000);
    const items: Record<number, FirebaseItem> = {
      12345: mockItem,
      6667: { id: 6667, type: 'comment', by: 'asker', text: 'Only a flagged reply.', parent: 12345, kids: [6668], time: now - 600 },
      6668: { id: 6668, type: 'comment', by: 'troll', text: 'Killed text', dead: true, parent: 6667, kids: [6669], time: now - 500 },
    };
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => items[Number(id)] ?? null);
    let serve!: () => void;
    const served = new Promise<void>(resolve => { serve = resolve; });
    server.use(
      http.get(`${ALGOLIA_API}/items/:id`, () => HttpResponse.json({
        id: 6667, type: 'comment', author: 'asker', text: 'Only a flagged reply.', created_at_i: now - 600,
        parent_id: 12345, story_id: 12345, children: [],
      })),
      http.get(`${ALGOLIA_API}/search`, async ({ request }) => {
        if (new URL(request.url).searchParams.get('tags') !== 'comment,story_12345') return;
        await served;
        return HttpResponse.json({
          hits: [
            { objectID: '6667', author: 'asker', comment_text: 'Only a flagged reply.', created_at_i: now - 600, parent_id: 12345 },
            { objectID: '6669', author: 'replier', comment_text: 'Reply to a flagged comment', created_at_i: now - 400, parent_id: 6668 },
          ],
          nbHits: 2,
          nbPages: 1,
        });
      }),
    );

    render(<FullScreenComment commentId={6667} />);

    const replies = (await screen.findByText('asker')).closest('article')!.nextElementSibling!;
    expect(replies.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No replies yet.')).not.toBeInTheDocument();

    serve();
    expect(await screen.findByText('[flagged]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 reply' })).toBeInTheDocument();
    expect(replies.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByText('No replies yet.')).not.toBeInTheDocument();
  });
});

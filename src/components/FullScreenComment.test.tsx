import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../test/test-utils';
import { FullScreenComment } from './FullScreenComment';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { ALGOLIA_API } from '../config/api';
import { hnSdk } from '../api/hnSdk';
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
});

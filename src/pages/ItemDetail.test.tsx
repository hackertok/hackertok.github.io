import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router';
import { ItemDetail } from './ItemDetail';
import { clearViewed, markViewed, isViewed } from '../utils/viewedItems';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { hnSdk } from '../api/hnSdk';
import { ALGOLIA_API } from '../config/api';
import { mockAlgoliaCommentItem } from '../mocks/handlers';
import type { FirebaseItem } from '../types';

const defaultItem: FirebaseItem = {
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

// Render ItemDetail inside a route so useParams() resolves :id
function renderItemDetail(itemId: number) {
  return render(
    <Routes>
      <Route path="/item/:id" element={<ItemDetail />} />
    </Routes>,
    { initialEntries: [`/item/${itemId}`] }
  );
}

describe('ItemDetail', () => {
  beforeEach(() => {
    clearViewed();
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 12345) return defaultItem;
      return null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    server.resetHandlers();
  });

  describe('viewed state', () => {
    it('shows unviewed title color by default', async () => {
      renderItemDetail(12345);

      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-foreground');
      expect(heading).not.toHaveClass('text-viewed');
    });

    it('shows viewed title color when item was previously viewed', async () => {
      markViewed(12345);
      renderItemDetail(12345);

      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-viewed');
      expect(heading).not.toHaveClass('text-foreground');
    });

    it('marks item as viewed and updates title color on external link click', async () => {
      renderItemDetail(12345);

      const titleLink = await screen.findByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
      expect(titleLink.closest('h1')).toHaveClass('text-foreground');

      fireEvent.click(titleLink);

      await waitFor(() => {
        expect(titleLink.closest('h1')).toHaveClass('text-viewed');
      });

      // Persistence side of the contract — class change alone wouldn't
      // catch a regression that skips the storage write.
      expect(isViewed(12345)).toBe(true);
    });
  });

  describe('back-to-home action on not-found', () => {
    beforeEach(() => {
      vi.spyOn(hnSdk, 'readItem').mockResolvedValue(null);
    });

    it('links to / with "Back to Home" label', async () => {
      renderItemDetail(99999999);

      const link = await screen.findByRole('link', { name: /back to home/i });
      expect(link).toHaveAttribute('href', '/');
    });
  });

  describe('comments that keep failing', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps the story on screen through every automatic comments retry', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let commentRequests = 0;
      server.use(
        http.get(`${ALGOLIA_API}/search`, () => {
          commentRequests++;
          return new HttpResponse(null, { status: 503 });
        }),
      );

      const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

      renderItemDetail(12345);

      await screen.findByRole('heading', { level: 1 });
      // The first load, then three retries 2s, 4s and 8s apart.
      for (let requests = 1; requests <= 4; requests++) {
        for (let step = 0; step < 100 && commentRequests < requests; step++) await advance(100);
        await advance(100);
        expect(commentRequests).toBe(requests);
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      }

      for (let step = 0; step < 20 && !screen.queryByRole('button', { name: 'Retry' }); step++) await advance(100);
      const retry = screen.getByRole('button', { name: 'Retry' });
      expect(screen.queryByText('Failed to load item')).not.toBeInTheDocument();
      expect(commentRequests).toBe(4);

      server.use(
        http.get(`${ALGOLIA_API}/search`, () => HttpResponse.json({
          hits: [{ objectID: '1001', author: 'patio11', comment_text: 'Loaded on retry', created_at_i: 1000, parent_id: 12345, story_id: 12345 }],
          nbHits: 1, page: 0, nbPages: 1, hitsPerPage: 200,
        })),
      );
      fireEvent.click(retry);

      expect(await screen.findByText('Loaded on retry')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    it('keeps a comment on screen through every automatic replies retry', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const text = 'The wasm-bindgen approach is really interesting.';
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => (
        Number(id) === 1001
          ? { id: 1001, by: 'patio11', text, time: Math.floor(Date.now() / 1000) - 1800, parent: 12345, type: 'comment' }
          : defaultItem
      ));
      let repliesRequests = 0;
      server.use(
        http.get(`${ALGOLIA_API}/items/:id`, () => {
          repliesRequests++;
          return new HttpResponse(null, { status: 503 });
        }),
      );

      const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

      renderItemDetail(1001);

      await screen.findByText(text);
      // The first load, then three retries 2s, 4s and 8s apart.
      for (let requests = 1; requests <= 4; requests++) {
        for (let step = 0; step < 100 && repliesRequests < requests; step++) await advance(100);
        await advance(100);
        expect(repliesRequests).toBe(requests);
        expect(screen.getByText(text)).toBeInTheDocument();
      }

      for (let step = 0; step < 20 && !screen.queryByRole('button', { name: 'Retry' }); step++) await advance(100);
      const retry = screen.getByRole('button', { name: 'Retry' });
      expect(screen.queryByText('Failed to load comment')).not.toBeInTheDocument();
      expect(screen.getByText('patio11')).toBeInTheDocument();
      expect(repliesRequests).toBe(4);

      server.use(
        http.get(`${ALGOLIA_API}/items/:id`, () => HttpResponse.json(mockAlgoliaCommentItem)),
      );
      fireEvent.click(retry);

      expect(await screen.findByText('tptacek')).toBeInTheDocument();
      expect(screen.getByText('patio11')).toBeInTheDocument();
    });
  });

  describe('comment detection', () => {
    it('renders CommentDetail when item.type is comment', async () => {
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === 1001) {
          return { id: 1001, by: 'patio11', text: 'The wasm-bindgen approach is really interesting.', time: Math.floor(Date.now() / 1000) - 1800, parent: 12345, type: 'comment' };
        }
        return { id: Number(id), title: 'Rust Is the Future of JavaScript Infrastructure', by: 'leerob', score: 284, time: Math.floor(Date.now() / 1000) - 3600, descendants: 137, type: 'story' };
      });

      server.use(
        http.get(`${ALGOLIA_API}/items/:id`, () => {
          return HttpResponse.json(mockAlgoliaCommentItem);
        }),
      );

      renderItemDetail(1001);

      await waitFor(() => {
        expect(screen.getByText('patio11')).toBeInTheDocument();
      });

      const parentLink = await screen.findByRole('link', { name: 'parent' });
      expect(parentLink).toBeInTheDocument();

      // "points" is item-specific — its absence proves we routed to
      // CommentDetail (not ItemArticle).
      expect(screen.queryByText(/points/)).not.toBeInTheDocument();
    });
  });
});

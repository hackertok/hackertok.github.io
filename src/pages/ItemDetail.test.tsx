import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router-dom';
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

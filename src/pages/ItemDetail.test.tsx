import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router-dom';
import { ItemDetail } from './ItemDetail';
import { clearViewed, markViewed, isViewed } from '../utils/viewedItems';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { FIREBASE_API, ALGOLIA_API } from '../config/api';
import { mockAlgoliaCommentItem } from '../mocks/handlers';

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
  });

  describe('viewed state', () => {
    it('shows unviewed title color by default', async () => {
      renderItemDetail(12345);

      // Wait for item to load
      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-foreground');
      expect(heading).not.toHaveClass('text-viewed');
    });

    it('shows viewed title color when item was previously viewed', async () => {
      markViewed(12345);
      renderItemDetail(12345);

      // Wait for item to load
      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-viewed');
      expect(heading).not.toHaveClass('text-foreground');
    });

    it('marks item as viewed and updates title color on external link click', async () => {
      renderItemDetail(12345);

      // Wait for item to load - title link should appear
      const titleLink = await screen.findByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
      expect(titleLink.closest('h1')).toHaveClass('text-foreground');

      fireEvent.click(titleLink);

      // Title should now have viewed color
      await waitFor(() => {
        expect(titleLink.closest('h1')).toHaveClass('text-viewed');
      });

      // Should be persisted to storage
      expect(isViewed(12345)).toBe(true);
    });
  });

  describe('past link', () => {
    it('links to Algolia with type=story', async () => {
      renderItemDetail(12345);

      const pastLink = await screen.findByRole('link', { name: 'past' });
      expect(pastLink).toHaveAttribute('href', expect.stringContaining('type=story'));
    });
  });

  describe('comment detection', () => {
    it('renders CommentDetail when item.type is comment', async () => {
      // Override Firebase to return a comment item
      server.use(
        http.get(`${FIREBASE_API}/item/:id.json`, ({ params }) => {
          const id = parseInt(params.id as string, 10);
          if (id === 1001) {
            return HttpResponse.json({
              id: 1001,
              by: 'patio11',
              text: 'The wasm-bindgen approach is really interesting.',
              time: Math.floor(Date.now() / 1000) - 1800,
              parent: 12345,
              type: 'comment',
            });
          }
          // Return item for story_id fetch (item title)
          return HttpResponse.json({
            id,
            title: 'Rust Is the Future of JavaScript Infrastructure',
            by: 'leerob',
            score: 284,
            time: Math.floor(Date.now() / 1000) - 3600,
            descendants: 137,
            type: 'story',
          });
        }),
        http.get(`${ALGOLIA_API}/items/:id`, () => {
          return HttpResponse.json(mockAlgoliaCommentItem);
        }),
      );

      renderItemDetail(1001);

      // Should render CommentDetail, not the normal item view
      await waitFor(() => {
        expect(screen.getByText('patio11')).toBeInTheDocument();
      });

      // Should show parent link after Algolia data loads
      const parentLink = await screen.findByRole('link', { name: 'parent' });
      expect(parentLink).toBeInTheDocument();

      // Should NOT show item-specific elements like "points"
      expect(screen.queryByText(/points/)).not.toBeInTheDocument();
    });
  });
});

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
import type { LocationState } from '../types';
import type { InitialEntry } from 'react-router';

// Render ItemDetail inside a route so useParams() resolves :id
function renderItemDetail(itemId: number) {
  return render(
    <Routes>
      <Route path="/item/:id" element={<ItemDetail />} />
    </Routes>,
    { initialEntries: [`/item/${itemId}`] }
  );
}

function renderItemDetailWithState(itemId: number, state?: LocationState) {
  const entry: InitialEntry = state
    ? { pathname: `/item/${itemId}`, state }
    : `/item/${itemId}`;
  return render(
    <Routes>
      <Route path="/item/:id" element={<ItemDetail />} />
    </Routes>,
    { initialEntries: [entry] }
  );
}

describe('ItemDetail', () => {
  beforeEach(() => {
    clearViewed();
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

  describe('back-to-feed action on not-found', () => {
    // Null response → NotFoundError → isNotFound=true → "Back to feed" link.
    beforeEach(() => {
      server.use(
        http.get(`${FIREBASE_API}/item/:id.json`, () => HttpResponse.json(null)),
      );
    });

    it('points to /from/:domain when state.fromDomain is set', async () => {
      renderItemDetailWithState(99999999, { fromDomain: 'example.com' });

      const link = await screen.findByRole('link', { name: /back to feed/i });
      expect(link).toHaveAttribute('href', '/from/example.com');
    });

    it('points to the feed path when state.from is set', async () => {
      renderItemDetailWithState(99999999, { from: 'best' });

      const link = await screen.findByRole('link', { name: /back to feed/i });
      expect(link).toHaveAttribute('href', '/best');
    });

    it('points to / when no navigation state is provided', async () => {
      renderItemDetailWithState(99999999);

      const link = await screen.findByRole('link', { name: /back to feed/i });
      expect(link).toHaveAttribute('href', '/');
    });

    it('prefers fromDomain over from when both are present', async () => {
      // Currently mutually exclusive in production, but the priority
      // (fromDomain wins as the more specific origin) is pinned defensively.
      renderItemDetailWithState(99999999, {
        from: 'best',
        fromDomain: 'example.com',
      });

      const link = await screen.findByRole('link', { name: /back to feed/i });
      expect(link).toHaveAttribute('href', '/from/example.com');
    });

    it('points to /submitted/:user when state.fromUser is set', async () => {
      renderItemDetailWithState(99999999, { fromUser: 'pg' });

      const link = await screen.findByRole('link', { name: /back to feed/i });
      expect(link).toHaveAttribute('href', '/submitted/pg');
    });

    it('prefers fromUser over fromDomain when both are present', async () => {
      // Origin priority: fromUser > fromDomain > from. Locked defensively.
      renderItemDetailWithState(99999999, {
        from: 'best',
        fromDomain: 'example.com',
        fromUser: 'pg',
      });

      const link = await screen.findByRole('link', { name: /back to feed/i });
      expect(link).toHaveAttribute('href', '/submitted/pg');
    });
  });

  describe('comment detection', () => {
    it('renders CommentDetail when item.type is comment', async () => {
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
          // Fallback handler covers the parent-story fetch (item title lookup).
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

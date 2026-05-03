import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '../test/test-utils';
import { FullScreenItem } from './FullScreenItem';
import { clearViewed, markViewed, isViewed } from '../utils/viewedItems';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { FIREBASE_API } from '../config/api';

describe('FullScreenItem', () => {
  beforeEach(() => {
    clearViewed();
  });

  describe('viewed state', () => {
    it('shows unviewed title color by default', async () => {
      render(<FullScreenItem itemId={12345} />);

      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-foreground');
      expect(heading).not.toHaveClass('text-viewed');
    });

    it('shows viewed title color when story was previously viewed', async () => {
      markViewed(12345);
      render(<FullScreenItem itemId={12345} />);

      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-viewed');
      expect(heading).not.toHaveClass('text-foreground');
    });

    it('marks story as viewed and updates title color on external link click', async () => {
      render(<FullScreenItem itemId={12345} />);

      const titleLink = await screen.findByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
      expect(titleLink.closest('h1')).toHaveClass('text-foreground');

      fireEvent.click(titleLink);

      await waitFor(() => {
        expect(titleLink.closest('h1')).toHaveClass('text-viewed');
      });

      expect(isViewed(12345)).toBe(true);
    });
  });

  describe('comment handling', () => {
    it('shows "Item not found" when item type is comment', async () => {
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
      );

      render(<FullScreenItem itemId={1001} />);

      // Story-only viewer must reject comment-typed items rather than render them as stories.
      await waitFor(() => {
        expect(screen.getByText('Item not found')).toBeInTheDocument();
      });
    });
  });
});

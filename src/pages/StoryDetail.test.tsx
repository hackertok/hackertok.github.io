import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router-dom';
import { StoryDetail } from './StoryDetail';
import { clearViewed, markViewed, isViewed } from '../utils/viewedStories';

// Render StoryDetail inside a route so useParams() resolves :id
function renderStoryDetail(storyId: number) {
  return render(
    <Routes>
      <Route path="/item/:id" element={<StoryDetail />} />
    </Routes>,
    { initialEntries: [`/item/${storyId}`] }
  );
}

describe('StoryDetail', () => {
  beforeEach(() => {
    clearViewed();
  });

  describe('viewed state', () => {
    it('shows unviewed title color by default', async () => {
      renderStoryDetail(12345);

      // Wait for story to load
      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-gray-900');
      expect(heading).not.toHaveClass('text-gray-500');
    });

    it('shows viewed title color when story was previously viewed', async () => {
      markViewed(12345);
      renderStoryDetail(12345);

      // Wait for story to load
      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-gray-500');
      expect(heading).not.toHaveClass('text-gray-900');
    });

    it('marks story as viewed and updates title color on external link click', async () => {
      renderStoryDetail(12345);

      // Wait for story to load - title link should appear
      const titleLink = await screen.findByRole('link', { name: 'Test Story Title' });
      expect(titleLink.closest('h1')).toHaveClass('text-gray-900');

      fireEvent.click(titleLink);

      // Title should now have viewed color
      await waitFor(() => {
        expect(titleLink.closest('h1')).toHaveClass('text-gray-500');
      });

      // Should be persisted to storage
      expect(isViewed(12345)).toBe(true);
    });
  });
});

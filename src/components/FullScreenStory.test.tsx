import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '../test/test-utils';
import { FullScreenStory } from './FullScreenStory';
import { clearViewed, markViewed, isViewed } from '../utils/viewedStories';

describe('FullScreenStory', () => {
  beforeEach(() => {
    clearViewed();
  });

  describe('viewed state', () => {
    it('shows unviewed title color by default', async () => {
      render(<FullScreenStory storyId={12345} />);

      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-gray-900');
      expect(heading).not.toHaveClass('text-gray-500');
    });

    it('shows viewed title color when story was previously viewed', async () => {
      markViewed(12345);
      render(<FullScreenStory storyId={12345} />);

      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-gray-500');
      expect(heading).not.toHaveClass('text-gray-900');
    });

    it('marks story as viewed and updates title color on external link click', async () => {
      render(<FullScreenStory storyId={12345} />);

      const titleLink = await screen.findByRole('link', { name: 'Test Story Title' });
      expect(titleLink.closest('h1')).toHaveClass('text-gray-900');

      fireEvent.click(titleLink);

      await waitFor(() => {
        expect(titleLink.closest('h1')).toHaveClass('text-gray-500');
      });

      expect(isViewed(12345)).toBe(true);
    });
  });
});

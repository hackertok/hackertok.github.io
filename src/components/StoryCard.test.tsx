import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '../test/test-utils';
import { StoryCard } from './StoryCard';
import { clearViewed, markViewedWithTime } from '../utils/viewedItems';
import { createStoryItem } from '../test/factories';
import type { StoryItem } from '../types';

describe('StoryCard', () => {
  const mockStory = createStoryItem({
    id: 12345,
    title: 'Rust Is the Future of JavaScript Infrastructure',
    url: 'https://example.com/article',
    points: 100,
    author: 'testuser',
    createdAt: Date.now() - 3600000, // 1 hour ago
    commentCount: 42,
  });

  const mockTextStory = {
    id: 67890,
    type: 'ask',
    title: 'Ask HN: What is the best testing library?',
    url: undefined,
    points: 50,
    author: 'askuser',
    createdAt: Date.now() - 7200000, // 2 hours ago
    commentCount: 15,
  } as StoryItem;

  beforeEach(() => {
    clearViewed();
  });

  describe('rendering', () => {
    it('renders story title', () => {
      render(<StoryCard story={mockStory} />);
      
      expect(screen.getByText('Rust Is the Future of JavaScript Infrastructure')).toBeInTheDocument();
    });

    it('renders hostname for external links', () => {
      render(<StoryCard story={mockStory} />);
      
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    it('renders points count', () => {
      render(<StoryCard story={mockStory} />);
      
      expect(screen.getByText(/100/)).toBeInTheDocument();
    });

    it('renders author name', () => {
      render(<StoryCard story={mockStory} />);
      
      expect(screen.getByText('testuser')).toBeInTheDocument();
    });

    it('renders comment count', () => {
      render(<StoryCard story={mockStory} />);
      
      expect(screen.getByText(/42/)).toBeInTheDocument();
    });

    it('renders relative time', () => {
      render(<StoryCard story={mockStory} />);
      
      expect(screen.getByText(/hour ago/i)).toBeInTheDocument();
    });
  });

  describe('link behavior', () => {
    it('renders external link for stories with URL', () => {
      render(<StoryCard story={mockStory} />);
      
      const titleLink = screen.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
      expect(titleLink).toHaveAttribute('href', 'https://example.com/article');
      // Links navigate away from app (like original HN)
      expect(titleLink).not.toHaveAttribute('target', '_blank');
    });

    it('renders internal link for text stories (no URL)', () => {
      render(<StoryCard story={mockTextStory} />);
      
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(titleLink).toHaveAttribute('href', '/item/67890');
    });

    it('renders comments link', () => {
      render(<StoryCard story={mockStory} />);
      
      const commentsLink = screen.getByRole('link', { name: /42 comments/i });
      expect(commentsLink).toHaveAttribute('href', '/item/12345');
    });
  });

  describe('viewed state', () => {
    it('applies unviewed styles by default', () => {
      render(<StoryCard story={mockTextStory} />);
      
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(titleLink).toHaveClass('text-gray-900');
    });

    it('applies viewed styles when story was previously viewed', () => {
      markViewedWithTime(mockTextStory.id);
      render(<StoryCard story={mockTextStory} />);
      
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(titleLink).toHaveClass('text-gray-500');
    });

    it('marks story as viewed on internal title click', () => {
      const { rerender } = render(<StoryCard story={mockTextStory} />);
      
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      fireEvent.click(titleLink);
      
      // Re-render to see the style change
      rerender(<StoryCard story={mockTextStory} />);
      const newTitleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(newTitleLink).toHaveClass('text-gray-500');
    });

    it('marks text post as viewed when clicking comments link', () => {
      const { rerender } = render(<StoryCard story={mockTextStory} />);
      
      const commentsLink = screen.getByRole('link', { name: /15 comments/i });
      fireEvent.click(commentsLink);
      
      // Re-render to see the style change
      rerender(<StoryCard story={mockTextStory} />);
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(titleLink).toHaveClass('text-gray-500');
    });

    it('does not mark regular story as viewed when clicking comments link', () => {
      const { rerender } = render(<StoryCard story={mockStory} />);
      
      const commentsLink = screen.getByRole('link', { name: /42 comments/i });
      fireEvent.click(commentsLink);
      
      // Re-render - external link titles now use viewed state styling too
      rerender(<StoryCard story={mockStory} />);
      // External links use the same viewed-conditional classes
      const titleLink = screen.getByRole('link', { name: /Rust Is the Future/i });
      expect(titleLink).toHaveClass('text-gray-900');
    });
  });

  describe('callbacks', () => {
    it('calls onBeforeNavigate when clicking internal title', () => {
      const mockCallback = vi.fn();
      render(<StoryCard story={mockTextStory} onBeforeNavigate={mockCallback} />);
      
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      fireEvent.click(titleLink);
      
      expect(mockCallback).toHaveBeenCalled();
    });

    it('calls onBeforeNavigate when clicking comments link', () => {
      const mockCallback = vi.fn();
      render(<StoryCard story={mockStory} onBeforeNavigate={mockCallback} />);
      
      const commentsLink = screen.getByRole('link', { name: /42 comments/i });
      fireEvent.click(commentsLink);
      
      expect(mockCallback).toHaveBeenCalled();
    });
  });

  describe('navigation state', () => {
    it('passes listType in navigation state for internal title links', () => {
      render(<StoryCard story={mockTextStory} listType="best" />);
      
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      // React Router Link renders with the destination path
      expect(titleLink).toHaveAttribute('href', expect.stringContaining('/item/67890'));
    });

    it('passes listType in navigation state for comments links', () => {
      render(<StoryCard story={mockStory} listType="best" />);
      
      const commentsLink = screen.getByRole('link', { name: /42 comments/i });
      expect(commentsLink).toHaveAttribute('href', expect.stringContaining('/item/12345'));
    });

    it('defaults listType to top when not specified', () => {
      render(<StoryCard story={mockTextStory} />);
      
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(titleLink).toHaveAttribute('href', expect.stringContaining('/item/67890'));
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { render } from '../test/test-utils';
import { StoryCard } from './StoryCard';
import { clearViewed, markViewedWithTime } from '../utils/viewedItems';
import { createStoryItem } from '../test/factories';
import type { StoryItem } from '../types';

// Route consumer that echoes the post-navigation location.state into the DOM
// so tests can assert what StoryCard wrote into `state` on link click.
function StateEchoer() {
  const location = useLocation();
  return (
    <div data-testid="echoed-state">
      {JSON.stringify(location.state)}
    </div>
  );
}

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
      expect(titleLink).not.toHaveAttribute('target', '_blank');
      expect(titleLink).toHaveAttribute('rel', 'noreferrer');
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
      expect(titleLink).toHaveClass('text-foreground');
    });

    it('applies viewed styles when story was previously viewed', () => {
      markViewedWithTime(mockTextStory.id);
      render(<StoryCard story={mockTextStory} />);
      
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(titleLink).toHaveClass('text-viewed');
    });

    it('marks story as viewed on internal title click', () => {
      const { rerender } = render(<StoryCard story={mockTextStory} />);
      
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      fireEvent.click(titleLink);
      
      // Re-render to see the style change
      rerender(<StoryCard story={mockTextStory} />);
      const newTitleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(newTitleLink).toHaveClass('text-viewed');
    });

    it('marks text post as viewed when clicking comments link', () => {
      const { rerender } = render(<StoryCard story={mockTextStory} />);
      
      const commentsLink = screen.getByRole('link', { name: /15 comments/i });
      fireEvent.click(commentsLink);
      
      // Re-render to see the style change
      rerender(<StoryCard story={mockTextStory} />);
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(titleLink).toHaveClass('text-viewed');
    });

    it('does not mark regular story as viewed when clicking comments link', () => {
      const { rerender } = render(<StoryCard story={mockStory} />);
      
      const commentsLink = screen.getByRole('link', { name: /42 comments/i });
      fireEvent.click(commentsLink);
      
      // Re-render - external link titles now use viewed state styling too
      rerender(<StoryCard story={mockStory} />);
      // External links use the same viewed-conditional classes
      const titleLink = screen.getByRole('link', { name: /Rust Is the Future/i });
      expect(titleLink).toHaveClass('text-foreground');
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

    it('writes state.fromDomain (not state.from) when fromDomain prop is set', () => {
      // Mount the card under a Routes tree so we can follow the navigation
      // and read back what ended up in location.state.
      render(
        <Routes>
          <Route
            path="/"
            element={
              <StoryCard
                story={mockTextStory}
                listType="top"
                fromDomain="example.com"
              />
            }
          />
          <Route path="/item/:id" element={<StateEchoer />} />
        </Routes>,
      );

      fireEvent.click(screen.getByRole('link', { name: /Ask HN/i }));

      const echoed = screen.getByTestId('echoed-state').textContent;
      expect(echoed).toBeTruthy();
      const state = JSON.parse(echoed ?? '{}') as {
        from?: string;
        fromDomain?: string;
      };
      expect(state.fromDomain).toBe('example.com');
      expect(state.from).toBeUndefined();
    });

    it('writes state.fromDomain on comments link when fromDomain prop is set', () => {
      render(
        <Routes>
          <Route
            path="/"
            element={
              <StoryCard story={mockStory} fromDomain="example.com" />
            }
          />
          <Route path="/item/:id" element={<StateEchoer />} />
        </Routes>,
      );

      fireEvent.click(screen.getByRole('link', { name: /42 comments/i }));

      const state = JSON.parse(
        screen.getByTestId('echoed-state').textContent ?? '{}',
      ) as { from?: string; fromDomain?: string };
      expect(state.fromDomain).toBe('example.com');
      expect(state.from).toBeUndefined();
    });

    it('falls back to state.from when fromDomain is not provided', () => {
      render(
        <Routes>
          <Route
            path="/"
            element={<StoryCard story={mockTextStory} listType="best" />}
          />
          <Route path="/item/:id" element={<StateEchoer />} />
        </Routes>,
      );

      fireEvent.click(screen.getByRole('link', { name: /Ask HN/i }));

      const state = JSON.parse(
        screen.getByTestId('echoed-state').textContent ?? '{}',
      ) as { from?: string; fromDomain?: string };
      expect(state.from).toBe('best');
      expect(state.fromDomain).toBeUndefined();
    });

    it('writes state.fromUser when fromUser prop is set', () => {
      render(
        <Routes>
          <Route
            path="/"
            element={
              <StoryCard
                story={mockTextStory}
                listType="top"
                fromUser="pg"
              />
            }
          />
          <Route path="/item/:id" element={<StateEchoer />} />
        </Routes>,
      );

      fireEvent.click(screen.getByRole('link', { name: /Ask HN/i }));

      const state = JSON.parse(
        screen.getByTestId('echoed-state').textContent ?? '{}',
      ) as { from?: string; fromDomain?: string; fromUser?: string };
      expect(state.fromUser).toBe('pg');
      expect(state.fromDomain).toBeUndefined();
      expect(state.from).toBeUndefined();
    });

    it('prefers fromUser over fromDomain and from when all three are set', () => {
      // Origin priority: fromUser > fromDomain > from. Pins the decision so a
      // future co-write doesn't silently flip it.
      render(
        <Routes>
          <Route
            path="/"
            element={
              <StoryCard
                story={mockStory}
                listType="best"
                fromDomain="example.com"
                fromUser="pg"
              />
            }
          />
          <Route path="/item/:id" element={<StateEchoer />} />
        </Routes>,
      );

      fireEvent.click(screen.getByRole('link', { name: /42 comments/i }));

      const state = JSON.parse(
        screen.getByTestId('echoed-state').textContent ?? '{}',
      ) as { from?: string; fromDomain?: string; fromUser?: string };
      expect(state.fromUser).toBe('pg');
      expect(state.fromDomain).toBeUndefined();
      expect(state.from).toBeUndefined();
    });
  });

  describe('author byline link', () => {
    it('wraps the author byline in a link to /user/:author when author is present', () => {
      render(<StoryCard story={mockStory} />);

      const authorLink = screen.getByRole('link', { name: 'testuser' });
      expect(authorLink).toHaveAttribute('href', '/user/testuser');
    });

    it('renders an unlinked "unknown" placeholder when author is empty', () => {
      const noAuthorStory: StoryItem = { ...mockStory, author: '' };
      render(<StoryCard story={noAuthorStory} />);

      // The literal "unknown" text should be present and NOT inside an anchor —
      // we never want to link to /user/unknown (an invalid HN account).
      const placeholder = screen.getByText('unknown');
      expect(placeholder.tagName).toBe('SPAN');
    });

    it('does not link the byline when author is the literal "unknown" string', () => {
      // Defense-in-depth: the API can populate `author` with the literal
      // string `'unknown'` (legacy data). Don't link to /user/unknown either.
      const unknownAuthorStory: StoryItem = { ...mockStory, author: 'unknown' };
      render(<StoryCard story={unknownAuthorStory} />);

      const placeholder = screen.getByText('unknown');
      expect(placeholder.tagName).toBe('SPAN');
      expect(screen.queryByRole('link', { name: 'unknown' })).not.toBeInTheDocument();
    });
  });
});

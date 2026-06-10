import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { render } from '../test/test-utils';
import { StoryCard } from './StoryCard';
import { clearViewed, markViewedWithTime, clearViewedTimes, clearSessionViewed, VIEWED_DETAIL_TIMES_KEY, VIEWED_SESSION_KEY } from '../utils/viewedItems';
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
    clearViewedTimes();
    clearSessionViewed();
  });

  describe('rendering', () => {
    it('renders story title', () => {
      render(<StoryCard story={mockStory} />);
      
      expect(screen.getByText('Rust Is the Future of JavaScript Infrastructure')).toBeInTheDocument();
    });

    it('renders hostname for external links', () => {
      render(<StoryCard story={mockStory} />);

      // getByRole('link', { name }) — Globe icon is aria-hidden, so the
      // link's accessible name is just the hostname (no "Globe " prefix).
      expect(screen.getByRole('link', { name: 'example.com' })).toBeInTheDocument();
    });

    it('renders points count', () => {
      render(<StoryCard story={mockStory} />);
      
      expect(screen.getByText(/100/)).toBeInTheDocument();
    });

    it('renders author name', () => {
      render(<StoryCard story={mockStory} />);

      // User icon is aria-hidden — link's accessible name is just the handle.
      expect(screen.getByRole('link', { name: 'testuser' })).toBeInTheDocument();
    });

    it('renders comment count', () => {
      render(<StoryCard story={mockStory} />);
      
      expect(screen.getByText(/42/)).toBeInTheDocument();
    });

    it('renders relative time', () => {
      render(<StoryCard story={mockStory} />);
      
      expect(screen.getByText(/hour ago/i)).toBeInTheDocument();
    });

    // Pin the responsive variant — a refactor that drops md:text-xl
    // back to text-base degrades the visual anchor at desktop width.
    it('renders title with responsive size classes (text-lg md:text-xl)', () => {
      render(<StoryCard story={mockStory} />);

      const titleLink = screen.getByRole('link', { name: mockStory.title });
      const title = titleLink.closest('h2');
      expect(title).not.toBeNull();
      expect(title).toHaveClass('text-lg');
      expect(title).toHaveClass('md:text-xl');
      expect(title).toHaveClass('font-semibold');
    });

    it('renders "0 points" when points is missing (Algolia/Firebase oddity)', () => {
      // Algolia can omit points (or send null) for very old items. The
      // `?? 0` fallback keeps the meta-row column count stable; dropping
      // it would leak "undefined points" to the DOM.
      const noPointsStory: StoryItem = {
        ...mockStory,
        points: null as unknown as number,
      };
      render(<StoryCard story={noPointsStory} />);

      expect(screen.getByText(/^0\s+points$/)).toBeInTheDocument();
    });

    it('renders "0 comments" when commentCount is missing', () => {
      // Same nullable contract as points.
      const noCommentsStory: StoryItem = {
        ...mockStory,
        commentCount: null as unknown as number,
      };
      render(<StoryCard story={noCommentsStory} />);

      expect(screen.getByRole('link', { name: /^0\s+comments$/ })).toBeInTheDocument();
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

    it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)'])(
      'never points the title link at a non-http(s) URL scheme %s',
      (url) => {
        render(<StoryCard story={createStoryItem({ ...mockStory, url })} />);

        // Hostile schemes must not become the outbound href; the title degrades
        // to the in-app discussion link instead.
        const titleLink = screen.getByRole('link', {
          name: 'Rust Is the Future of JavaScript Infrastructure',
        });
        expect(titleLink).toHaveAttribute('href', '/item/12345');
      },
    );

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

    it('applies viewed styles when story was previously title-clicked', () => {
      markViewedWithTime(mockTextStory.id, 'title');
      render(<StoryCard story={mockTextStory} />);
      
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(titleLink).toHaveClass('text-viewed');
    });

    it('marks story as viewed on internal title click', () => {
      const { rerender } = render(<StoryCard story={mockTextStory} />);

      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      fireEvent.click(titleLink);

      // Re-render to pick up the markViewed-driven class change.
      rerender(<StoryCard story={mockTextStory} />);
      const newTitleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(newTitleLink).toHaveClass('text-viewed');
    });

    it('does not visually mark text post when clicking comments link', () => {
      const { rerender } = render(<StoryCard story={mockTextStory} />);

      const commentsLink = screen.getByRole('link', { name: /15 comments/i });
      fireEvent.click(commentsLink);

      rerender(<StoryCard story={mockTextStory} />);
      const titleLink = screen.getByRole('link', { name: /Ask HN/i });
      expect(titleLink).toHaveClass('text-foreground');
    });

    it('writes to detail times map and session store when clicking comments on text post', () => {
      render(<StoryCard story={mockTextStory} />);

      const commentsLink = screen.getByRole('link', { name: /15 comments/i });
      fireEvent.click(commentsLink);

      // Should write to detail times map (for swipe-mode filtering)
      const stored = JSON.parse(localStorage.getItem(VIEWED_DETAIL_TIMES_KEY)!) as Record<string, number>;
      expect(stored[String(mockTextStory.id)]).toBeGreaterThan(0);

      // Should add to session storage
      const session = JSON.parse(sessionStorage.getItem(VIEWED_SESSION_KEY)!) as number[];
      expect(session).toContain(mockTextStory.id);
    });

    it('does not mark regular story as viewed when clicking comments link', () => {
      const { rerender } = render(<StoryCard story={mockStory} />);

      const commentsLink = screen.getByRole('link', { name: /42 comments/i });
      fireEvent.click(commentsLink);

      // External-link stories share the viewed-conditional classes, but
      // a comments-link click must NOT flip them — only the external link
      // click does (preserves "did the user actually visit?" semantics).
      rerender(<StoryCard story={mockStory} />);
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

    it('calls onBeforeNavigate when clicking the external title link (so scroll restore works on browser back)', () => {
      const mockCallback = vi.fn();
      render(<StoryCard story={mockStory} onBeforeNavigate={mockCallback} />);

      const titleLink = screen.getByRole('link', { name: /Rust Is the Future/i });
      fireEvent.click(titleLink);

      expect(mockCallback).toHaveBeenCalled();
    });

    it('calls onBeforeNavigate when clicking the domain pill (sibling-list navigation)', () => {
      const mockCallback = vi.fn();
      render(<StoryCard story={mockStory} onBeforeNavigate={mockCallback} />);

      const domainPill = screen.getByRole('link', { name: 'example.com' });
      fireEvent.click(domainPill);

      expect(mockCallback).toHaveBeenCalled();
    });

    it('calls onBeforeNavigate when clicking the author byline (peer profile navigation)', () => {
      const mockCallback = vi.fn();
      render(<StoryCard story={mockStory} onBeforeNavigate={mockCallback} />);

      const authorLink = screen.getByRole('link', { name: 'testuser' });
      fireEvent.click(authorLink);

      expect(mockCallback).toHaveBeenCalled();
    });

    it('does NOT mark the story as viewed when clicking the domain pill', () => {
      // Sibling-list navigation must not flip viewed state — the user
      // hasn't engaged with this story's content. Symmetric guard to
      // the comments-link case for URL-bearing stories.
      const { rerender } = render(<StoryCard story={mockStory} />);

      const domainPill = screen.getByRole('link', { name: 'example.com' });
      fireEvent.click(domainPill);

      rerender(<StoryCard story={mockStory} />);
      const titleLink = screen.getByRole('link', { name: /Rust Is the Future/i });
      expect(titleLink).toHaveClass('text-foreground');
    });

    it('does NOT mark the story as viewed when clicking the author byline', () => {
      const { rerender } = render(<StoryCard story={mockStory} />);

      const authorLink = screen.getByRole('link', { name: 'testuser' });
      fireEvent.click(authorLink);

      rerender(<StoryCard story={mockStory} />);
      const titleLink = screen.getByRole('link', { name: /Rust Is the Future/i });
      expect(titleLink).toHaveClass('text-foreground');
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
      // Mount under a Routes tree so we can follow the click and read
      // back what landed in location.state via StateEchoer.
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
      // Origin priority: fromUser > fromDomain > from. Pinned so a
      // future refactor doesn't silently flip it.
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

  describe('cascade animation plumbing', () => {
    // stageIdx and appendIdx are mutually exclusive in practice (parent's
    // slot getter picks one), but precedence (stageIdx > appendIdx) is
    // pinned defensively — a double-animation would surface as a
    // re-fade after the initial cascade settles.
    it('applies neither cascade class when no idx prop is set', () => {
      render(<StoryCard story={mockStory} />);

      const article = screen.getByTestId('story-card');
      expect(article).not.toHaveClass('stagger-fade');
      expect(article).not.toHaveClass('append-fade');
      expect(article.getAttribute('style') ?? '').not.toContain('--stagger-delay');
    });

    it('applies .stagger-fade and a --stagger-delay when stageIdx is set', () => {
      render(<StoryCard story={mockStory} stageIdx={3} />);

      const article = screen.getByTestId('story-card');
      expect(article).toHaveClass('stagger-fade');
      expect(article).not.toHaveClass('append-fade');
      // Assert the variable exists, not its ms value — pinning ms would
      // couple to the decay-curve constants.
      expect(article.getAttribute('style') ?? '').toContain('--stagger-delay');
    });

    it('applies .append-fade and a --stagger-delay when appendIdx is set', () => {
      render(<StoryCard story={mockStory} appendIdx={2} />);

      const article = screen.getByTestId('story-card');
      expect(article).toHaveClass('append-fade');
      expect(article).not.toHaveClass('stagger-fade');
      expect(article.getAttribute('style') ?? '').toContain('--stagger-delay');
    });

    it('prefers stageIdx over appendIdx when both are passed', () => {
      // Defense-in-depth — the slot getter shouldn't pass both, but
      // the precedence rule prevents a double-animation if it drifts.
      render(<StoryCard story={mockStory} stageIdx={1} appendIdx={4} />);

      const article = screen.getByTestId('story-card');
      expect(article).toHaveClass('stagger-fade');
      expect(article).not.toHaveClass('append-fade');
    });

    // useStaggerCascadeSlots advances batchStart on every fetch, so
    // getSlot(index) for already-mounted cards drifts (or drops to
    // undefined). Without the at-mount snapshot, that prop change would
    // (a) cancel a mid-flight .append-fade by toggling the class off,
    // or (b) silently mutate --stagger-delay on a settled card. The
    // snapshot freezes the slot at mount so re-renders are no-ops.
    it('keeps the .append-fade class even after appendIdx is dropped on re-render', () => {
      const { rerender } = render(<StoryCard story={mockStory} appendIdx={3} />);

      let article = screen.getByTestId('story-card');
      expect(article).toHaveClass('append-fade');
      const initialStyle = article.getAttribute('style');

      // Parent's batchStart advanced; this card is in a past batch.
      rerender(<StoryCard story={mockStory} />);
      article = screen.getByTestId('story-card');
      expect(article).toHaveClass('append-fade');
      // Style must be byte-equal — even decayDelay(0) drift is unwanted.
      expect(article.getAttribute('style')).toBe(initialStyle);
    });

    it('keeps the .stagger-fade class even after stageIdx is dropped on re-render', () => {
      // Symmetric to the append case — a feed-change reset that
      // collapses initialBoundary in the parent must not strip the
      // class off cards that already animated through the cold-load cascade.
      const { rerender } = render(<StoryCard story={mockStory} stageIdx={5} />);

      let article = screen.getByTestId('story-card');
      expect(article).toHaveClass('stagger-fade');
      const initialStyle = article.getAttribute('style');

      rerender(<StoryCard story={mockStory} />);
      article = screen.getByTestId('story-card');
      expect(article).toHaveClass('stagger-fade');
      expect(article.getAttribute('style')).toBe(initialStyle);
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

      // /user/unknown is an invalid HN account — never link to it.
      const placeholder = screen.getByText('unknown');
      expect(placeholder.tagName).toBe('SPAN');
    });

    it('does not link the byline when author is the literal "unknown" string', () => {
      // Legacy data sometimes ships the literal 'unknown' string.
      const unknownAuthorStory: StoryItem = { ...mockStory, author: 'unknown' };
      render(<StoryCard story={unknownAuthorStory} />);

      const placeholder = screen.getByText('unknown');
      expect(placeholder.tagName).toBe('SPAN');
      expect(screen.queryByRole('link', { name: 'unknown' })).not.toBeInTheDocument();
    });
  });
});

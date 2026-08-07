import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router';
import { render } from '../test/test-utils';
import { CommentArticle } from './CommentArticle';

// Echoes location.state into the DOM so tests can assert what
// CommentArticle's parent / thread links wrote into router state.
function StateEchoer() {
  const location = useLocation();
  return (
    <div data-testid="echoed-state">{JSON.stringify(location.state)}</div>
  );
}

describe('CommentArticle', () => {
  const mockComment = {
    author: 'patio11',
    text: '<p>Some thoughts.</p>',
    createdAt: Date.now() - 3600000,
    parentId: 12345,
  };

  function renderArticle(overrides: Partial<Parameters<typeof CommentArticle>[0]> = {}) {
    return render(
      <CommentArticle
        comment={mockComment}
        replies={[]}
        itemId={12345}
        itemTitle="Some story"
        loading={false}
        {...overrides}
      />,
    );
  }

  it('wraps the author byline in a link to /user/:author', () => {
    renderArticle();

    const authorLink = screen.getByRole('link', { name: 'patio11' });
    expect(authorLink).toHaveAttribute('href', '/user/patio11');
  });

  it('renders a parent link to /item/:parentId when the comment has a parent', () => {
    renderArticle();

    const parentLink = screen.getByRole('link', { name: 'parent' });
    expect(parentLink).toHaveAttribute('href', '/item/12345');
  });

  it('omits the parent link when parentId is null', () => {
    // Top-level comments have no parent — drop the pill, don't render a dangling link.
    renderArticle({ comment: { ...mockComment, parentId: null } });

    expect(screen.queryByRole('link', { name: 'parent' })).not.toBeInTheDocument();
  });

  it('renders a thread link to the focal item when itemId + itemTitle resolve', () => {
    renderArticle();

    const threadLink = screen.getByRole('link', { name: 'Some story' });
    expect(threadLink).toHaveAttribute('href', '/item/12345');
  });

  it('renders a relative time inside a <time> element with a sane dateTime attribute', () => {
    // <time dateTime> must be machine-parseable ISO; visible text is the relative label.
    renderArticle();

    const time = screen.getByText(/ago/i);
    expect(time.tagName).toBe('TIME');
    const isoAttr = time.getAttribute('dateTime') ?? '';
    expect(isoAttr).not.toBe('');
    expect(Number.isNaN(Date.parse(isoAttr))).toBe(false);
  });

  it('renders sanitized comment HTML', () => {
    // sanitizeHtml + dangerouslySetInnerHTML: <p> must survive as a real
    // paragraph (not escaped text or an inert div).
    renderArticle();

    const paragraph = screen.getByText('Some thoughts.');
    expect(paragraph.tagName).toBe('P');
  });

  describe('thread title — loading skeleton', () => {
    // Meta row reserves the title's width while loading so it doesn't
    // reflow on resolve. .animate-pulse is the cheapest single assertion
    // that the loading branch is wired up.

    it('shows a pulse placeholder while the focal item title is loading', () => {
      render(
        <CommentArticle
          comment={mockComment}
          replies={[]}
          itemId={null}
          itemTitle={null}
          loading={true}
        />,
      );

      // Scope to <article> — the sibling CommentSkeletonTree also uses
      // .animate-pulse, so a container-wide query would let the meta-row
      // title skeleton be silently deleted in a future refactor.
      const article = screen.getByRole('article');
      expect(
        article.querySelectorAll('.animate-pulse').length,
      ).toBeGreaterThan(0);
      expect(screen.queryByRole('link', { name: /some story/i })).not.toBeInTheDocument();
    });

    it('shows the resolved title link (no skeleton) once itemTitle arrives', () => {
      renderArticle({ loading: false });

      expect(
        screen.getByRole('link', { name: 'Some story' }),
      ).toHaveAttribute('href', '/item/12345');
    });

    it('falls back to a generic "story" link when loading settles without a title', () => {
      // Failure mode: parent fetch errored or returned a titleless item.
      // Without the fallback, the skeleton would pulse forever and a
      // screen reader would have no navigable anchor.
      render(
        <CommentArticle
          comment={mockComment}
          replies={[]}
          itemId={12345}
          itemTitle={null}
          loading={false}
        />,
      );

      const fallback = screen.getByRole('link', { name: /^story$/i });
      expect(fallback).toHaveAttribute('href', '/item/12345');
      // Skeleton must clear when fallback link renders — otherwise both UIs surface.
      const article = screen.getByRole('article');
      expect(article.querySelector('.animate-pulse')).toBeNull();
    });
  });

  describe('author guard', () => {
    // 'unknown' / '' must not mint a dead /user/unknown or /user/ link —
    // fall back to a plain non-link byline. See isKnownAuthor.

    it('does not render an author link when the author is the literal "unknown"', () => {
      renderArticle({
        comment: { ...mockComment, author: 'unknown' },
      });

      expect(
        screen.queryByRole('link', { name: 'unknown' }),
      ).not.toBeInTheDocument();
      // Visible label still surfaces so the meta-row rhythm stays intact.
      expect(screen.getByText('unknown')).toBeInTheDocument();
    });

    it('does not render an author link when the author is an empty string', () => {
      renderArticle({
        comment: { ...mockComment, author: '' },
      });

      // Empty author falls back to the literal "unknown" label, no link.
      expect(
        screen.queryByRole('link', { name: 'unknown' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('unknown')).toBeInTheDocument();
    });
  });

  describe('OP highlight', () => {
    // OP badge is a SIBLING of the author Link (not child), so the
    // link's accessible name stays exactly the handle — getByRole('link',
    // { name: 'patio11' }) keeps working across the suite.

    it('renders an OP badge when storyAuthor matches comment.author', () => {
      renderArticle({ storyAuthor: 'patio11' });

      expect(screen.getByLabelText('Original poster')).toBeInTheDocument();
      expect(screen.getByText('OP')).toBeInTheDocument();
    });

    it('does not render an OP badge when storyAuthor differs from comment.author', () => {
      renderArticle({ storyAuthor: 'someone-else' });

      expect(screen.queryByLabelText('Original poster')).not.toBeInTheDocument();
      expect(screen.queryByText('OP')).not.toBeInTheDocument();
    });

    it.each([
      { label: 'literal "unknown"', storyAuthor: 'unknown' },
      { label: 'empty string', storyAuthor: '' },
    ])(
      'does not render OP badge when storyAuthor is the $label',
      ({ storyAuthor }) => {
        renderArticle({ storyAuthor });

        expect(screen.queryByLabelText('Original poster')).not.toBeInTheDocument();
      },
    );

    // Sibling-pattern regression — see AuthorByline.tsx for rationale.
    it('keeps the author Link accessible name unchanged when OP', () => {
      renderArticle({ storyAuthor: 'patio11' });

      const link = screen.getByRole('link', { name: 'patio11' });
      expect(link).toHaveAttribute('href', '/user/patio11');
    });
  });

  describe('parent link — router state propagation', () => {
    // state.isComment tells the destination route whether it's loading a
    // comment thread (true) or the story root (false). Drives the
    // Header's "comments" pill and feed-tab deactivation. Two cases:
    //   parentId === itemId → parent IS the story → isComment: false
    //   parentId !== itemId → parent is another comment → isComment: true

    it('writes state.isComment=false when the parent IS the focal item (story root)', () => {
      // parentId === itemId === 12345 — clicking parent goes to the
      // story (not another comment).
      render(
        <Routes>
          <Route
            path="/"
            element={
              <CommentArticle
                comment={{ ...mockComment, parentId: 12345 }}
                replies={[]}
                itemId={12345}
                itemTitle="Some story"
                loading={false}
              />
            }
          />
          <Route path="/item/:id" element={<StateEchoer />} />
        </Routes>,
      );

      fireEvent.click(screen.getByRole('link', { name: 'parent' }));

      const state = JSON.parse(
        screen.getByTestId('echoed-state').textContent ?? '{}',
      ) as { isComment?: boolean };
      expect(state.isComment).toBe(false);
    });

    it('writes state.isComment=true when the parent is another comment (not the focal item)', () => {
      // parentId !== itemId — clicking parent goes to a comment view,
      // which surfaces the Header "comments" pill and suppresses feed highlights.
      render(
        <Routes>
          <Route
            path="/"
            element={
              <CommentArticle
                comment={{ ...mockComment, parentId: 99999 }}
                replies={[]}
                itemId={12345}
                itemTitle="Some story"
                loading={false}
              />
            }
          />
          <Route path="/item/:id" element={<StateEchoer />} />
        </Routes>,
      );

      fireEvent.click(screen.getByRole('link', { name: 'parent' }));

      const state = JSON.parse(
        screen.getByTestId('echoed-state').textContent ?? '{}',
      ) as { isComment?: boolean };
      expect(state.isComment).toBe(true);
    });

    it('writes state.isComment=false on the thread/title link (always the story root)', () => {
      // Thread-title link always points at the focal story —
      // isComment=false regardless of nesting.
      render(
        <Routes>
          <Route
            path="/"
            element={
              <CommentArticle
                comment={{ ...mockComment, parentId: 99999 }}
                replies={[]}
                itemId={12345}
                itemTitle="Some story"
                loading={false}
              />
            }
          />
          <Route path="/item/:id" element={<StateEchoer />} />
        </Routes>,
      );

      fireEvent.click(screen.getByRole('link', { name: 'Some story' }));

      const state = JSON.parse(
        screen.getByTestId('echoed-state').textContent ?? '{}',
      ) as { isComment?: boolean };
      expect(state.isComment).toBe(false);
    });
  });
});

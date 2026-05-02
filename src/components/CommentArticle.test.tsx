import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router-dom';
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
    // Top-level comments under a story have no parent comment to navigate
    // back to — the meta row should drop the `parent` pill rather than
    // render a dangling link.
    renderArticle({ comment: { ...mockComment, parentId: null } });

    expect(screen.queryByRole('link', { name: 'parent' })).not.toBeInTheDocument();
  });

  it('renders a thread link to the focal item when itemId + itemTitle resolve', () => {
    renderArticle();

    const threadLink = screen.getByRole('link', { name: 'Some story' });
    expect(threadLink).toHaveAttribute('href', '/item/12345');
  });

  it('renders a relative time inside a <time> element with a sane dateTime attribute', () => {
    // The byline's time pill drives both visible relative phrasing
    // ("X minutes/hours ago") and machine-readable ISO via `dateTime`.
    // `mockComment.createdAt` is one hour ago, so the visible text must
    // include "ago" and `dateTime` must be a parseable ISO string.
    renderArticle();

    const time = screen.getByText(/ago/i);
    expect(time.tagName).toBe('TIME');
    const isoAttr = time.getAttribute('dateTime') ?? '';
    expect(isoAttr).not.toBe('');
    expect(Number.isNaN(Date.parse(isoAttr))).toBe(false);
  });

  it('renders sanitized comment HTML', () => {
    // CommentArticle pipes `comment.text` through `sanitizeHtml` and uses
    // `dangerouslySetInnerHTML`. A plain `<p>` should survive the sanitizer
    // and surface as a paragraph (not as escaped text or as an inert div).
    renderArticle();

    const paragraph = screen.getByText('Some thoughts.');
    expect(paragraph.tagName).toBe('P');
  });

  describe('thread title — loading skeleton', () => {
    // CommentArticle's meta row reserves space for the focal item's title
    // even before it resolves: while `loading=true && itemTitle=null`, we
    // render a pulse placeholder of the same approximate width so the row
    // doesn't reflow when the title arrives. The skeleton uses the
    // `animate-pulse` Tailwind utility, which is the same primitive used
    // by every other skeleton in the app — making it the cheapest single
    // assertion that the loading branch is wired up correctly.

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

      // The thread-title slot contains an inline-block .animate-pulse span
      // when loading; this is the visible "skeleton bar" before the title
      // resolves. Scope the query to the <article> element so we don't
      // accidentally pass via the CommentSkeletonTree rows (which also
      // use .animate-pulse) — that tree lives in the sibling <section>,
      // and asserting against the whole render container would let the
      // meta-row title skeleton be silently deleted in a future refactor.
      const article = screen.getByRole('article');
      expect(
        article.querySelectorAll('.animate-pulse').length,
      ).toBeGreaterThan(0);
      // And the resolved title link must NOT be present yet.
      expect(screen.queryByRole('link', { name: /some story/i })).not.toBeInTheDocument();
    });

    it('shows the resolved title link (no skeleton) once itemTitle arrives', () => {
      // Sanity-check the inverse: when itemTitle resolves, the meta row
      // shows the actual link — the skeleton in the thread-title slot must
      // disappear. (The CommentSkeletonTree below also disappears once
      // loading=false; this test pins the title-slot specifically.)
      renderArticle({ loading: false });

      expect(
        screen.getByRole('link', { name: 'Some story' }),
      ).toHaveAttribute('href', '/item/12345');
    });

    it('falls back to a generic "story" link when loading settles without a title', () => {
      // Failure mode: parent fetch errored or returned a titleless item,
      // so `itemTitle` stays null after `loading` flips to false. Without
      // an explicit fallback the meta row would sit on the skeleton
      // forever. We render a plain `story` link to /item/:itemId so the
      // user still has a working path back to the discussion root, and
      // assistive tech still has a navigable anchor (no perpetual
      // pulse-bar staring at a screen reader).
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
      // No skeleton inside the article when we've decided to render the
      // fallback link instead.
      const article = screen.getByRole('article');
      expect(article.querySelector('.animate-pulse')).toBeNull();
    });
  });

  describe('author guard', () => {
    // HN's degraded payloads use the literal `'unknown'` placeholder for
    // missing/anonymous authors (see e2e/fixtures/api-mocks.ts) and empty
    // strings slip through `?? ''` fallbacks elsewhere. CommentArticle
    // must not mint a dead `/user/unknown` or `/user/` link in either
    // case — it should fall back to a plain non-link byline.

    it('does not render an author link when the author is the literal "unknown"', () => {
      renderArticle({
        comment: { ...mockComment, author: 'unknown' },
      });

      expect(
        screen.queryByRole('link', { name: 'unknown' }),
      ).not.toBeInTheDocument();
      // The label still surfaces (so the meta row keeps its rhythm).
      expect(screen.getByText('unknown')).toBeInTheDocument();
    });

    it('does not render an author link when the author is an empty string', () => {
      renderArticle({
        comment: { ...mockComment, author: '' },
      });

      // Empty author falls back to displaying the literal "unknown" so
      // the byline stays meaningful, with no link to /user/.
      expect(
        screen.queryByRole('link', { name: 'unknown' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('unknown')).toBeInTheDocument();
    });
  });

  describe('parent link — router state propagation', () => {
    // The parent link writes `state.isComment` so the destination route
    // knows whether it's loading another comment thread (true) or the
    // story root (false). This drives the Header's "comments" pill
    // visibility and the feed-tab deactivation rule. Two cases:
    //   1. parentId === itemId → parent IS the story → isComment: false
    //   2. parentId !== itemId → parent is another comment → isComment: true
    // We follow the navigation under a Routes tree so we can read back
    // what landed in `useLocation().state`.

    it('writes state.isComment=false when the parent IS the focal item (story root)', () => {
      // mockComment.parentId === 12345; render with itemId === 12345 so
      // the parent IS the focal story. Clicking parent should land on the
      // story page with isComment=false (we're going to the story, not to
      // another comment).
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
      // parentId differs from itemId — the parent is another comment in
      // the tree, not the story root. Clicking parent should land on a
      // comment view (isComment=true), which causes the Header to render
      // its "comments" pill and suppress feed highlighting.
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
      // The thread-title link always points at the focal story, so its
      // state is always isComment=false — independent of whether the
      // current comment is nested or top-level.
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

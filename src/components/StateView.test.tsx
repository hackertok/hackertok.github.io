import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '../test/test-utils';
import { StateView } from './StateView';

// StateView is the universal "this list / item / page is in a non-content
// state" surface. Every retry / empty / error / not-found / deleted / end
// scene in the app routes through it (StoryList, DomainStories,
// UserSubmissions, UserProfile, ItemDetail, FullScreenItem, swipe viewers,
// CommentsSection, CommentDetail, FullScreenComment, ErrorBoundary), so
// regressions here cascade widely. The matrix below covers the public
// contract: variant defaults, compact vs non-compact, the action element
// (Link via `to` vs Button via `onClick`), and the RefreshCw icon swap
// driven by the action label.

describe('StateView', () => {
  describe('variant defaults', () => {
    // Each variant has a built-in title/description fallback — pages that
    // pass nothing get a sensible default. Pin the text so a future copy
    // change is intentional rather than silent.

    it('uses default title for "not-found" when no title prop is provided', () => {
      render(<StateView variant="not-found" />);
      expect(screen.getByText('Item not found')).toBeInTheDocument();
    });

    it('uses default title for "error" when no title prop is provided', () => {
      render(<StateView variant="error" />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('uses default title for "empty" when no title prop is provided', () => {
      render(<StateView variant="empty" />);
      expect(screen.getByText('No comments yet.')).toBeInTheDocument();
    });

    it('uses default title for "deleted" when no title prop is provided', () => {
      render(<StateView variant="deleted" />);
      expect(screen.getByText('Comment deleted')).toBeInTheDocument();
    });

    it('uses default description for "end" when no description prop is provided', () => {
      render(<StateView variant="end" />);
      expect(screen.getByText("You've reached the end")).toBeInTheDocument();
    });

    it('lets explicit title prop override the variant default', () => {
      render(<StateView variant="error" title="Custom error title" />);
      expect(screen.getByText('Custom error title')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('lets explicit description prop override the variant default', () => {
      render(
        <StateView
          variant="error"
          description="Custom recovery instructions."
        />,
      );
      expect(
        screen.getByText('Custom recovery instructions.'),
      ).toBeInTheDocument();
    });
  });

  describe('compact mode', () => {
    // Compact lays out as a single row (icon + label) for inline contexts
    // like "no replies yet" inside a thread; non-compact is the full
    // centered scene with a title heading. The structural difference we
    // can assert without snapshotting: compact suppresses the <h2> title.

    it('renders the title as an <h2> in non-compact mode', () => {
      render(<StateView variant="error" title="Boom" />);
      const heading = screen.getByRole('heading', { level: 2, name: 'Boom' });
      expect(heading).toBeInTheDocument();
    });

    it('does NOT render an <h2> in compact mode (single-row layout)', () => {
      render(<StateView variant="empty" compact title="No replies yet" />);
      expect(
        screen.queryByRole('heading', { name: 'No replies yet' }),
      ).not.toBeInTheDocument();
      // Title text still surfaces — just as an inline label, not a heading.
      expect(screen.getByText('No replies yet')).toBeInTheDocument();
    });

    it('renders an action link inline alongside the compact label', () => {
      // Compact + action.to is a real combination — used by inline empty
      // states that still need a recovery affordance (e.g. a small "Try
      // again" link beside a one-row "Couldn't load" message). The
      // contract under test: the link renders as an anchor with the
      // correct href, AND no <h2> heading appears (the layout stays
      // single-row, not the centered scene).
      render(
        <StateView
          variant="not-found"
          compact
          title="Comment unavailable"
          action={{ label: 'Go home', to: '/' }}
        />,
      );

      // Heading suppressed (compact mode).
      expect(
        screen.queryByRole('heading', { name: 'Comment unavailable' }),
      ).not.toBeInTheDocument();
      // Action still renders as a link with the expected href.
      const link = screen.getByRole('link', { name: /go home/i });
      expect(link).toHaveAttribute('href', '/');
      // And the title text is still surfaced as an inline label.
      expect(screen.getByText('Comment unavailable')).toBeInTheDocument();
    });
  });

  describe('action element', () => {
    // The action prop drives every retry / "go home" affordance in the app.
    // Rules under test:
    //   - action.to → renders an anchor (Link via Button asChild)
    //   - action.onClick alone → renders a real <button>
    //   - no action → no interactive element
    //   - error / not-found use button styling, others use link styling

    it('renders an anchor when action.to is provided', () => {
      render(
        <StateView
          variant="not-found"
          action={{ label: 'Go home', to: '/' }}
        />,
      );

      const link = screen.getByRole('link', { name: /go home/i });
      expect(link).toHaveAttribute('href', '/');
    });

    it('renders a button when action.onClick is provided (no action.to)', () => {
      const handler = vi.fn();
      render(
        <StateView
          variant="error"
          action={{ label: 'Retry', onClick: handler }}
        />,
      );

      const button = screen.getByRole('button', { name: /retry/i });
      expect(button).toBeInTheDocument();
      fireEvent.click(button);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('renders no interactive element when action is omitted', () => {
      render(<StateView variant="empty" />);
      expect(
        screen.queryByRole('button', { name: /retry|try again|go home/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /retry|try again|go home/i }),
      ).not.toBeInTheDocument();
    });

    it('fires action.onClick when present alongside action.to (Link onClick)', () => {
      // `to + onClick` is the swipe-viewer "navigate AND clear stale
      // session state" pattern. Both must run on click.
      const handler = vi.fn();
      render(
        <StateView
          variant="not-found"
          action={{ label: 'Go home', to: '/', onClick: handler }}
        />,
      );

      fireEvent.click(screen.getByRole('link', { name: /go home/i }));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('RefreshCw icon swap', () => {
    // The icon decision is driven entirely by the action.label regex
    // `/try again|retry/i`. This was a deliberate cross-cutting fix —
    // adding the icon at the StateView level propagates it to every
    // retry surface in the app without per-page edits. If a future
    // refactor narrows the regex (or moves the icon), regressions show
    // up everywhere at once, so the test belongs here, not on each
    // consumer.

    const hasIcon = (root: HTMLElement) =>
      root.querySelector('svg.lucide-refresh-cw, svg[class*="refresh"]') !==
      null;

    it('shows the RefreshCw icon when action.label is "Try Again"', () => {
      const { container } = render(
        <StateView
          variant="error"
          action={{ label: 'Try Again', onClick: vi.fn() }}
        />,
      );

      const button = screen.getByRole('button', { name: /try again/i });
      // The icon renders inside the button; assert at least one SVG child
      // exists. (We use a generic selector since the exact lucide class
      // name varies across versions; the strong contract is "an SVG was
      // rendered alongside the label".)
      expect(button.querySelector('svg')).not.toBeNull();
      expect(hasIcon(container)).toBe(true);
    });

    it('shows the RefreshCw icon when action.label is "Retry" (case-insensitive)', () => {
      render(
        <StateView
          variant="error"
          action={{ label: 'retry', onClick: vi.fn() }}
        />,
      );

      const button = screen.getByRole('button', { name: /retry/i });
      expect(button.querySelector('svg')).not.toBeNull();
    });

    it('does NOT show the RefreshCw icon for non-retry labels', () => {
      // "Go home" is the not-found page's primary action — no retry
      // semantics, so no refresh icon should appear next to it.
      render(
        <StateView
          variant="not-found"
          action={{ label: 'Go home', to: '/' }}
        />,
      );

      const link = screen.getByRole('link', { name: /go home/i });
      // No SVG inside the action element. (The variant scene SVG sits
      // outside the action, so this scoped check is safe.)
      expect(link.querySelector('svg')).toBeNull();
    });
  });
});

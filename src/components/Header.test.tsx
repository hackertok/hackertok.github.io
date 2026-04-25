import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Header } from './Header';

describe('Header', () => {
  describe('rendering', () => {
    it('renders logo', () => {
      render(<Header />);
      
      expect(screen.getByRole('link', { name: 'HackerTok' })).toBeInTheDocument();
    });

    it('renders best navigation link', () => {
      render(<Header />);
      
      expect(screen.getByRole('link', { name: /best/i })).toBeInTheDocument();
    });
  });

  describe('best button highlighting', () => {
    it('highlights best button on /best route', () => {
      render(<Header />, { initialEntries: ['/best'] });
      
      const bestLink = screen.getByRole('link', { name: /best/i });
      expect(bestLink).toHaveClass('bg-accent');
    });

    it('does not highlight best button on home route', () => {
      render(<Header />, { initialEntries: ['/'] });
      
      const bestLink = screen.getByRole('link', { name: /best/i });
      expect(bestLink).not.toHaveClass('bg-accent');
    });

    it('highlights best button on item detail when navigated from best list', () => {
      // Simulate navigation state from best list
      render(<Header />, { 
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'best' } }
        ] 
      });
      
      const bestLink = screen.getByRole('link', { name: /best/i });
      expect(bestLink).toHaveClass('bg-accent');
    });

    it('does not highlight best button on item detail when navigated from top list', () => {
      render(<Header />, { 
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'top' } }
        ] 
      });
      
      const bestLink = screen.getByRole('link', { name: /best/i });
      expect(bestLink).not.toHaveClass('bg-accent');
    });

    it('does not highlight best button on item detail without navigation state', () => {
      render(<Header />, { 
        initialEntries: ['/item/12345']
      });
      
      const bestLink = screen.getByRole('link', { name: /best/i });
      expect(bestLink).not.toHaveClass('bg-accent');
    });
  });

  describe('show button', () => {
    it('renders show navigation link', () => {
      render(<Header />);
      
      expect(screen.getByRole('link', { name: /show/i })).toBeInTheDocument();
    });

    it('highlights show button on /show route', () => {
      render(<Header />, { initialEntries: ['/show'] });
      
      const showLink = screen.getByRole('link', { name: /show/i });
      expect(showLink).toHaveClass('bg-accent');
    });

    it('does not highlight show button on home route', () => {
      render(<Header />, { initialEntries: ['/'] });
      
      const showLink = screen.getByRole('link', { name: /show/i });
      expect(showLink).not.toHaveClass('bg-accent');
    });

    it('highlights show button on item detail when navigated from show list', () => {
      render(<Header />, { 
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'show' } }
        ] 
      });
      
      const showLink = screen.getByRole('link', { name: /show/i });
      expect(showLink).toHaveClass('bg-accent');
    });

    it('does not highlight show button on item detail when navigated from top list', () => {
      render(<Header />, { 
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'top' } }
        ] 
      });
      
      const showLink = screen.getByRole('link', { name: /show/i });
      expect(showLink).not.toHaveClass('bg-accent');
    });
  });

  describe('ask button', () => {
    it('renders ask navigation link', () => {
      render(<Header />);
      
      expect(screen.getByRole('link', { name: /ask/i })).toBeInTheDocument();
    });

    it('highlights ask button on /ask route', () => {
      render(<Header />, { initialEntries: ['/ask'] });
      
      const askLink = screen.getByRole('link', { name: /ask/i });
      expect(askLink).toHaveClass('bg-accent');
    });

    it('does not highlight ask button on home route', () => {
      render(<Header />, { initialEntries: ['/'] });
      
      const askLink = screen.getByRole('link', { name: /ask/i });
      expect(askLink).not.toHaveClass('bg-accent');
    });

    it('highlights ask button on item detail when navigated from ask list', () => {
      render(<Header />, { 
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'ask' } }
        ] 
      });
      
      const askLink = screen.getByRole('link', { name: /ask/i });
      expect(askLink).toHaveClass('bg-accent');
    });

    it('does not highlight ask button on item detail when navigated from top list', () => {
      render(<Header />, { 
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'top' } }
        ] 
      });
      
      const askLink = screen.getByRole('link', { name: /ask/i });
      expect(askLink).not.toHaveClass('bg-accent');
    });
  });

  describe('from indicator', () => {
    const fromIndicator = () =>
      screen.queryByText('from', { selector: 'header nav span' });

    it('shows "from" indicator on /from/:domain list/swipe route', () => {
      render(<Header />, { initialEntries: ['/from/example.com'] });

      const indicator = fromIndicator();
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveClass('bg-accent');
    });

    it('keeps "from" visible on item detail when navigated from a domain', () => {
      // Covers both (a) the mobile swipe viewer rewriting /from/:domain to
      // /item/:id with state.fromDomain and (b) desktop StoryCard writing
      // state.fromDomain on internal navigation from a domain list.
      render(<Header />, {
        initialEntries: [
          { pathname: '/item/12345', state: { fromDomain: 'example.com' } },
        ],
      });

      const indicator = fromIndicator();
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveClass('bg-accent');
    });

    it('hides "from" on item detail without fromDomain state', () => {
      render(<Header />, {
        initialEntries: [{ pathname: '/item/12345', state: { from: 'best' } }],
      });

      expect(fromIndicator()).toBeNull();
    });

    it('hides "from" on item detail with no navigation state at all', () => {
      render(<Header />, { initialEntries: ['/item/12345'] });

      expect(fromIndicator()).toBeNull();
    });

    it('hides "from" when viewing a comment even if fromDomain is present', () => {
      // Comment view has its own "comments" indicator; suppress "from" to
      // mirror how feed tabs deactivate in comment view and avoid two
      // highlighted indicators competing for the same slot.
      render(<Header />, {
        initialEntries: [
          {
            pathname: '/item/12345',
            state: { fromDomain: 'example.com', isComment: true },
          },
        ],
      });

      expect(fromIndicator()).toBeNull();
    });

    it('hides "from" on feed pages', () => {
      render(<Header />, { initialEntries: ['/best'] });

      expect(fromIndicator()).toBeNull();
    });
  });

  describe('user indicator', () => {
    const userIndicator = () =>
      screen.queryByText('user', { selector: 'header nav span' });
    const fromIndicator = () =>
      screen.queryByText('from', { selector: 'header nav span' });
    const commentsIndicator = () =>
      screen.queryByText('comments', { selector: 'header nav span' });

    it('shows "user" indicator on /user/:id profile route', () => {
      render(<Header />, { initialEntries: ['/user/pg'] });

      const indicator = userIndicator();
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveClass('bg-accent');
    });

    it('shows "user" indicator on /submitted/:id list route', () => {
      render(<Header />, { initialEntries: ['/submitted/pg'] });

      const indicator = userIndicator();
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveClass('bg-accent');
    });

    it('keeps "user" visible on item detail when navigated from user submissions', () => {
      // Covers (a) the mobile swipe viewer rewriting /submitted/:id to
      // /item/:id with state.fromUser and (b) desktop StoryCard writing
      // state.fromUser on internal navigation from a user submissions list.
      render(<Header />, {
        initialEntries: [
          { pathname: '/item/12345', state: { fromUser: 'pg' } },
        ],
      });

      const indicator = userIndicator();
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveClass('bg-accent');
    });

    it('hides "user" on item detail without fromUser state', () => {
      render(<Header />, {
        initialEntries: [{ pathname: '/item/12345', state: { from: 'best' } }],
      });

      expect(userIndicator()).toBeNull();
    });

    it('hides "user" on item detail with no navigation state at all', () => {
      render(<Header />, { initialEntries: ['/item/12345'] });

      expect(userIndicator()).toBeNull();
    });

    it('hides "user" on feed pages', () => {
      render(<Header />, { initialEntries: ['/best'] });

      expect(userIndicator()).toBeNull();
    });

    it('hides "user" when viewing a comment even if fromUser is present', () => {
      // Comments view's dedicated indicator wins. Mirrors how `from` and
      // feed tabs deactivate in comment view so only one contextual pill
      // ever renders at a time.
      render(<Header />, {
        initialEntries: [
          {
            pathname: '/item/12345',
            state: { fromUser: 'pg', isComment: true },
          },
        ],
      });

      expect(userIndicator()).toBeNull();
    });

    it('prefers "user" over "from" when both fromUser and fromDomain are set', () => {
      // Priority: comments > user > from. With both fromUser and fromDomain,
      // user wins and from is suppressed so the nav row stays uncluttered.
      render(<Header />, {
        initialEntries: [
          {
            pathname: '/item/12345',
            state: { fromUser: 'pg', fromDomain: 'example.com' },
          },
        ],
      });

      expect(userIndicator()).not.toBeNull();
      expect(fromIndicator()).toBeNull();
    });

    it('prefers "comments" over "user" when both apply', () => {
      // The full priority chain in one assertion: comments > user.
      render(<Header />, {
        initialEntries: [
          {
            pathname: '/item/12345',
            state: { fromUser: 'pg', isComment: true },
          },
        ],
      });

      expect(commentsIndicator()).not.toBeNull();
      expect(userIndicator()).toBeNull();
    });
  });
});

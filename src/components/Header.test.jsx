import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Header } from './Header';

describe('Header', () => {
  describe('rendering', () => {
    it('renders logo', () => {
      render(<Header />);
      
      // Logo is split: "Hacker" + "Tok"
      expect(screen.getByText('Hacker')).toBeInTheDocument();
      expect(screen.getByText('Tok')).toBeInTheDocument();
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
      expect(bestLink).toHaveClass('bg-hn-orange');
    });

    it('does not highlight best button on home route', () => {
      render(<Header />, { initialEntries: ['/'] });
      
      const bestLink = screen.getByRole('link', { name: /best/i });
      expect(bestLink).not.toHaveClass('bg-hn-orange');
    });

    it('highlights best button on story detail when navigated from best list', () => {
      // Simulate navigation state from best list
      render(<Header />, { 
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'best' } }
        ] 
      });
      
      const bestLink = screen.getByRole('link', { name: /best/i });
      expect(bestLink).toHaveClass('bg-hn-orange');
    });

    it('does not highlight best button on story detail when navigated from top list', () => {
      render(<Header />, { 
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'top' } }
        ] 
      });
      
      const bestLink = screen.getByRole('link', { name: /best/i });
      expect(bestLink).not.toHaveClass('bg-hn-orange');
    });

    it('does not highlight best button on story detail without navigation state', () => {
      render(<Header />, { 
        initialEntries: ['/item/12345']
      });
      
      const bestLink = screen.getByRole('link', { name: /best/i });
      expect(bestLink).not.toHaveClass('bg-hn-orange');
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
      expect(showLink).toHaveClass('bg-hn-orange');
    });

    it('does not highlight show button on home route', () => {
      render(<Header />, { initialEntries: ['/'] });
      
      const showLink = screen.getByRole('link', { name: /show/i });
      expect(showLink).not.toHaveClass('bg-hn-orange');
    });

    it('highlights show button on story detail when navigated from show list', () => {
      render(<Header />, { 
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'show' } }
        ] 
      });
      
      const showLink = screen.getByRole('link', { name: /show/i });
      expect(showLink).toHaveClass('bg-hn-orange');
    });

    it('does not highlight show button on story detail when navigated from top list', () => {
      render(<Header />, { 
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'top' } }
        ] 
      });
      
      const showLink = screen.getByRole('link', { name: /show/i });
      expect(showLink).not.toHaveClass('bg-hn-orange');
    });
  });
});

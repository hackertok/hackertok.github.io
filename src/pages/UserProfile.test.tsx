import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router';
import { UserProfile } from './UserProfile';
import { __resetUserProfileCacheForTests } from '../hooks/useUserProfile';
import { ScrollContainerProvider } from '../context/ScrollContainerContext';
import { hnSdk } from '../api/hnSdk';
import type { UserProfile as UserProfileType } from '../types';

const mockUserProfile: UserProfileType = {
  id: 'leerob',
  created: 1160418092,
  karma: 12345,
  about: 'Engineer at Vercel. <a href="https://leerob.io">leerob.io</a>',
  submitted: [12345, 99999, 88888],
};

const mockMinimalUser: UserProfileType = {
  id: 'minimaluser',
  created: 1160418092,
  karma: 1,
  submitted: [],
};

function renderProfile(username: string) {
  // ScrollContainerProvider matches the production tree (App.tsx wraps the
  // router in it). Without it, `useScrollContainer()` returns its noop
  // fallback and the swipe-mode-class side effect can't be observed.
  return render(
    <ScrollContainerProvider>
      <Routes>
        <Route path="/user/:id" element={<UserProfile />} />
      </Routes>
    </ScrollContainerProvider>,
    { initialEntries: [`/user/${username}`] },
  );
}

describe('UserProfile', () => {
  beforeEach(() => {
    __resetUserProfileCacheForTests();
    document.documentElement.classList.remove('swipe-mode');
    document.body.classList.remove('swipe-mode');
    vi.spyOn(hnSdk, 'readUser').mockImplementation(async (username) => {
      if (username === 'leerob') return mockUserProfile;
      if (username === 'minimaluser') return mockMinimalUser;
      if (username === 'pg') return { id: 'pg', created: 1160418092, karma: 155555, submitted: [12345] };
      return null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loaded profile', () => {
    it('renders username and karma', async () => {
      renderProfile('leerob');

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'leerob' })).toBeInTheDocument();
      });

      expect(screen.getByText(/12,345 karma/)).toBeInTheDocument();
    });

    it('renders the account creation date as an absolute long-month date', async () => {
      // mockUserProfile.created = 1160418092 → 2006-10-09T20:21:32Z. The
      // visible string is rendered via `formatAbsoluteDate` (long-month,
      // no clock parts). We only assert locale-invariant pieces — the
      // year + an absent `H:MM` clock — so the test stays green regardless
      // of the host's `Intl.DateTimeFormat` defaults. The relative phrasing
      // ("X years ago") lives in the `<time title>` attribute and is
      // covered separately by the e2e suite.
      renderProfile('leerob');

      const time = await screen.findByText(/2006/);
      expect(time.tagName).toBe('TIME');
      expect(time.textContent ?? '').not.toMatch(/\d+:\d+/);
    });

    it('renders sanitized about HTML', async () => {
      renderProfile('leerob');

      await waitFor(() => {
        // sanitizeHtml preserves non-self/non-HN hosts verbatim (no rewrite).
        const link = screen.getByRole('link', { name: 'leerob.io' });
        expect(link).toHaveAttribute('href', 'https://leerob.io');
      });
    });

    it('renders the "submissions" metadata link to /submitted/:id', async () => {
      renderProfile('leerob');

      const link = await screen.findByRole('link', { name: 'submissions' });
      expect(link).toHaveAttribute('href', '/submitted/leerob');
    });

    it('does not render the about section when profile.about is missing', async () => {
      renderProfile('minimaluser');

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 1, name: 'minimaluser' }),
        ).toBeInTheDocument();
      });
    });

    it('preserves username case (HN is case-sensitive)', async () => {
      vi.spyOn(hnSdk, 'readUser').mockImplementation(async (username) => ({
        id: username,
        created: 1160418092,
        karma: 1,
        submitted: [],
      }));

      renderProfile('PaulG');

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'PaulG' })).toBeInTheDocument();
      });

      const submissionsLink = screen.getByRole('link', { name: 'submissions' });
      expect(submissionsLink).toHaveAttribute('href', '/submitted/PaulG');
    });
  });

  describe('not found', () => {
    beforeEach(() => {
      vi.spyOn(hnSdk, 'readUser').mockResolvedValue(null);
    });

    it('renders the "user not found" StateView when Firebase returns null', async () => {
      renderProfile('ghost');

      const link = await screen.findByRole('link', { name: /back to home/i });
      expect(link).toHaveAttribute('href', '/');
      expect(screen.getByText(/no user with the id "ghost"/i)).toBeInTheDocument();
    });

    it('sets the document title to "User not found"', async () => {
      renderProfile('ghost');

      await screen.findByRole('link', { name: /back to home/i });
      await waitFor(() => {
        expect(document.title).toBe('User not found | HackerTok');
      });
    });
  });

  describe('error', () => {
    beforeEach(() => {
      vi.spyOn(hnSdk, 'readUser').mockRejectedValue(new Error('Service unavailable'));
    });

    it('renders the error StateView with a Try Again action', async () => {
      renderProfile('leerob');

      await screen.findByRole('button', { name: /try again/i });
      expect(screen.getByText(/failed to load user/i)).toBeInTheDocument();
    });

    it('sets the document title to "Failed to load user"', async () => {
      renderProfile('leerob');

      await screen.findByRole('button', { name: /try again/i });
      await waitFor(() => {
        expect(document.title).toBe('Failed to load user | HackerTok');
      });
    });
  });

  describe('mobile swipe-mode bug', () => {
    // The bootstrap script in index.html applies `swipe-mode` to <html>/<body>
    // for all `#/...` routes on mobile so the swipe viewers don't double-paint
    // a scrollable page first. UserProfile is vertically scrollable, so it
    // must imperatively turn that class off on mount or direct loads end up
    // with `body { overflow: clip }` and the page can't scroll.
    it('removes the swipe-mode class from <html> and <body> on mount', async () => {
      document.documentElement.classList.add('swipe-mode');
      document.body.classList.add('swipe-mode');

      renderProfile('leerob');

      await waitFor(() => {
        expect(document.documentElement.classList.contains('swipe-mode')).toBe(false);
        expect(document.body.classList.contains('swipe-mode')).toBe(false);
      });
    });
  });
});

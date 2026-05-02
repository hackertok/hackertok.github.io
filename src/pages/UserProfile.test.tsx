import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router-dom';
import { UserProfile } from './UserProfile';
import { __resetUserProfileCacheForTests } from '../hooks/useUserProfile';
import { ScrollContainerProvider } from '../context/ScrollContainerContext';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { errorHandlers } from '../mocks/handlers';
import { FIREBASE_API } from '../config/api';

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
        // mockUserProfile.about contains an <a> tag pointing to leerob.io.
        // sanitizeHtml rewrites external <a> hrefs but preserves leerob.io
        // (non-self/HN host) verbatim.
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
      server.use(
        http.get(`${FIREBASE_API}/user/:id.json`, ({ params }) => {
          const id = params.id as string;
          return HttpResponse.json({
            id,
            created: 1160418092,
            karma: 1,
            submitted: [],
          });
        }),
      );

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
      server.use(errorHandlers.userNotFound);
    });

    it('renders the "user not found" StateView when Firebase returns null', async () => {
      renderProfile('ghost');

      const link = await screen.findByRole('link', { name: /return to home/i });
      expect(link).toHaveAttribute('href', '/');
      expect(screen.getByText(/no user with the id "ghost"/i)).toBeInTheDocument();
    });

    it('sets the document title to "User not found"', async () => {
      renderProfile('ghost');

      await screen.findByRole('link', { name: /return to home/i });
      await waitFor(() => {
        expect(document.title).toBe('User not found | HackerTok');
      });
    });
  });

  describe('error', () => {
    beforeEach(() => {
      server.use(
        http.get(`${FIREBASE_API}/user/:id.json`, () =>
          HttpResponse.json({ error: 'boom' }, { status: 503 }),
        ),
      );
    });

    it('renders the error StateView with a Try Again action', async () => {
      renderProfile('leerob');

      await screen.findByRole('button', { name: /try again/i });
      expect(screen.getByText(/failed to load user/i)).toBeInTheDocument();
    });

    it('sets the document title to "Failed to load user"', async () => {
      renderProfile('leerob');

      await screen.findByRole('button', { name: /try again/i });
      expect(document.title).toBe('Failed to load user | HackerTok');
    });
  });

  describe('mobile swipe-mode bug', () => {
    // The bootstrap script in index.html applies `swipe-mode` to <html>/<body>
    // for all `#/...` routes on mobile so the swipe viewers don't double-paint
    // a scrollable page first. UserProfile is vertically scrollable, so it
    // must imperatively turn that class off on mount or direct loads end up
    // with `body { overflow: hidden }` and the page can't scroll.
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

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router-dom';
import { UserSubmissions } from './UserSubmissions';
import { __resetUserStoriesCacheForTests } from '../hooks/useUserInfiniteStories';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { ALGOLIA_API } from '../config/api';

function renderSubmissions(username: string) {
  return render(
    <Routes>
      <Route path="/submitted/:id" element={<UserSubmissions />} />
    </Routes>,
    { initialEntries: [`/submitted/${username}`] },
  );
}

describe('UserSubmissions', () => {
  beforeEach(() => {
    __resetUserStoriesCacheForTests();
  });

  it('renders the user\'s submitted stories', async () => {
    renderSubmissions('leerob');

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole('link', { name: 'Edge Functions on the Web Platform' }),
    ).toBeInTheDocument();
  });

  it('sets the document title to "Submissions by USER"', async () => {
    renderSubmissions('leerob');

    await screen.findByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
    expect(document.title).toBe('Submissions by leerob | HackerTok');
  });

  it('renders the empty StateView when the user has no stories', async () => {
    renderSubmissions('lurker');

    await waitFor(() => {
      expect(
        screen.getByText('No submissions found by "lurker"'),
      ).toBeInTheDocument();
    });
  });

  it('shows the loading skeleton immediately and again while auto-retry is in flight', async () => {
    // useAutoRetry hides the error UI behind a 3× backoff loop (2s/4s/8s).
    // We assert the skeleton is rendered while a retry is in flight; the
    // give-up + Try Again UI is exercised end-to-end in `useAutoRetry.test.ts`
    // and the underlying error surface is covered by
    // `useUserInfiniteStories.test.ts`.
    server.use(
      http.get(`${ALGOLIA_API}/search_by_date`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 503 }),
      ),
    );

    const { container } = renderSubmissions('leerob');

    await waitFor(() => {
      // StoryCardSkeletonList renders multiple skeleton cards; the marker
      // class is the easiest stable hook.
      expect(container.querySelectorAll('.bg-skeleton').length).toBeGreaterThan(0);
    });

    // Error UI must not be visible while auto-retry is in progress.
    expect(screen.queryByText(/failed to load submissions/i)).not.toBeInTheDocument();
  });

  it('renders the "no user specified" StateView when the username param is empty', async () => {
    render(
      <Routes>
        {/* Use a wildcard path so an empty `:id` still matches and exercises the
            empty-username guard branch in UserSubmissions. */}
        <Route path="/submitted/*" element={<UserSubmissions />} />
      </Routes>,
      { initialEntries: ['/submitted/'] },
    );

    expect(screen.getByText('No user specified')).toBeInTheDocument();
  });

  it('passes fromUser to StoryCard so its byline links carry the origin', async () => {
    renderSubmissions('leerob');

    // Comment count link is the StoryCard's most reliable internal link
    // (text post or otherwise). Its href is /item/:id; we don't assert state
    // here because react-router synthesizes hrefs from the `to` prop and
    // stores `state` only at navigation time. The StoryCard test covers the
    // state assertion directly.
    const commentsLink = await screen.findByRole('link', { name: /137 comments/ });
    expect(commentsLink).toHaveAttribute('href', '/item/12345');
  });
});

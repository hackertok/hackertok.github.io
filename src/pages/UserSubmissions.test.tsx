import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router';
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
    // useAutoRetry hides the error UI behind 3× backoff (2/4/8s). The
    // give-up branch + Try Again UI live in useAutoRetry.test.ts; this
    // test only pins "skeleton, not error UI, while in flight".
    server.use(
      http.get(`${ALGOLIA_API}/search_by_date`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 503 }),
      ),
    );

    const { container } = renderSubmissions('leerob');

    await waitFor(() => {
      // .bg-skeleton is the stable marker class on StoryCardSkeletonList.
      expect(container.querySelectorAll('.bg-skeleton').length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/failed to load submissions/i)).not.toBeInTheDocument();
  });

  it('renders the "no user specified" StateView when the username param is empty', async () => {
    render(
      <Routes>
        {/* Wildcard path matches /submitted/ with no id — exercises the
            empty-username guard branch. */}
        <Route path="/submitted/*" element={<UserSubmissions />} />
      </Routes>,
      { initialEntries: ['/submitted/'] },
    );

    expect(screen.getByText('No user specified')).toBeInTheDocument();
  });

  it('passes fromUser to StoryCard so its byline links carry the origin', async () => {
    renderSubmissions('leerob');

    // Asserts only href here — react-router synthesizes href from `to`,
    // but `state` is only set at navigation time. State assertion lives
    // in StoryCard.test.tsx.
    const commentsLink = await screen.findByRole('link', { name: /137 comments/ });
    expect(commentsLink).toHaveAttribute('href', '/item/12345');
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router';
import { CommentDetail } from './CommentDetail';
import { server } from '../mocks/server';
import { ALGOLIA_API } from '../config/api';

function renderCommentDetail(commentId: number | string, initialData?: { author: string; text: string; createdAt: number }) {
  return render(
    <Routes>
      <Route path="/item/:id" element={<CommentDetail commentId={commentId} initialData={initialData} />} />
    </Routes>,
    { initialEntries: [`/item/${commentId}`] },
  );
}

describe('CommentDetail', () => {
  // Content rendering (author, text, parent link, title link, replies) is tested
  // in FullScreenComment.test.tsx. These tests focus on CommentDetail-specific behavior:
  // routing integration, progressive rendering, skeleton, and document title.

  it('shows skeleton while loading', () => {
    renderCommentDetail(1001);

    // animate-pulse container is the skeleton wrapper.
    const skeleton = document.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
  });

  it('uses initialData for progressive rendering', async () => {
    const initialData = {
      author: 'patio11',
      text: 'The wasm-bindgen approach is really interesting.',
      createdAt: Date.now(),
    };

    renderCommentDetail(1001, initialData);

    // initialData renders synchronously; replies arrive after the async fetch.
    expect(screen.getByText('patio11')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('tptacek')).toBeInTheDocument();
    });
  });

  it('sets document title', async () => {
    renderCommentDetail(1001);

    await waitFor(() => {
      expect(document.title).toContain('Comment by patio11');
    });
  });

  describe('when the comment keeps failing to load', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function failEveryRequest() {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      server.use(http.get(`${ALGOLIA_API}/items/:id`, () => new HttpResponse(null, { status: 503 })));
    }

    // The first load, then three retries 2s, 4s and 8s apart: about 14s.
    async function waitOutRetries() {
      for (let step = 0; step < 300 && !screen.queryByRole('button', { name: 'Retry' }); step++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      }
    }

    it('shows the page error once the retries run out with nothing to show', async () => {
      failEveryRequest();
      renderCommentDetail(1001);

      await waitOutRetries();

      expect(screen.getByText('Failed to load comment')).toBeInTheDocument();
    });

    it('keeps a comment from initialData and offers to retry its replies', async () => {
      failEveryRequest();
      renderCommentDetail(1001, { author: 'patio11', text: 'Seeded from Firebase.', createdAt: Date.now() });

      await waitOutRetries();

      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(screen.getByText('Seeded from Firebase.')).toBeInTheDocument();
      expect(screen.queryByText('Failed to load comment')).not.toBeInTheDocument();
      expect(screen.queryByText('No replies yet.')).not.toBeInTheDocument();
    });
  });
});

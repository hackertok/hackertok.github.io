import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router';
import { CommentDetail } from './CommentDetail';

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
});

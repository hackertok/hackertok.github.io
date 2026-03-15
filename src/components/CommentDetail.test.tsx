import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Routes, Route } from 'react-router-dom';
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
  it('renders comment author and text', async () => {
    renderCommentDetail(1001);

    await waitFor(() => {
      expect(screen.getByText('patio11')).toBeInTheDocument();
    });

    // Comment text contains code tag, check for string presence
    expect(screen.getByText(/wasm-bindgen/i)).toBeInTheDocument();
  });

  it('renders parent link', async () => {
    renderCommentDetail(1001);

    const parentLink = await screen.findByRole('link', { name: 'parent' });
    expect(parentLink).toBeInTheDocument();
    expect(parentLink).toHaveAttribute('href', '/item/12345');
  });

  it('renders "on: Item Title" link', async () => {
    renderCommentDetail(1001);

    // Wait for item title to load (background fetch)
    await waitFor(() => {
      expect(screen.getByText('Rust Is the Future of JavaScript Infrastructure')).toBeInTheDocument();
    });

    const itemLink = screen.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
    expect(itemLink).toHaveAttribute('href', '/item/12345');
  });

  it('renders replies', async () => {
    renderCommentDetail(1001);

    await waitFor(() => {
      expect(screen.getByText('tptacek')).toBeInTheDocument();
    });

    expect(screen.getByText(/DX improvements/i)).toBeInTheDocument();
    expect(screen.getByText(/1 reply/i)).toBeInTheDocument();
  });

  it('shows skeleton while loading', () => {
    renderCommentDetail(1001);

    // Should show loading skeleton initially (animate-pulse container)
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

    // Author should be visible immediately (from initialData)
    expect(screen.getByText('patio11')).toBeInTheDocument();

    // Replies should load later
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

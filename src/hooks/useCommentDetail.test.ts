import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useCommentDetail } from './useCommentDetail';
import { server } from '../mocks/server';
import { ALGOLIA_API, FIREBASE_API } from '../config/api';

describe('useCommentDetail', () => {
  afterEach(() => {
    server.resetHandlers();
  });

  it('fetches comment data and replies', async () => {
    const { result } = renderHook(() => useCommentDetail(1001));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.comment).toBeTruthy();
    expect(result.current.comment!.id).toBe(1001);
    expect(result.current.comment!.author).toBe('patio11');
    expect(result.current.comment!.parentId).toBe(12345);
    expect(result.current.itemId).toBe(12345);
    expect(result.current.replies).toHaveLength(1);
    expect(result.current.replies[0].id).toBe(2001);
    expect(result.current.error).toBeNull();
  });

  it('fetches item title in background', async () => {
    const { result } = renderHook(() => useCommentDetail(1001));

    await waitFor(() => {
      expect(result.current.itemTitle).toBe('Rust Is the Future of JavaScript Infrastructure');
    });
  });

  it('uses initialData for immediate display', async () => {
    const initialData = {
      author: 'patio11',
      text: 'Initial text',
      createdAt: Date.now(),
    };

    const { result } = renderHook(() => useCommentDetail(1001, initialData));

    // Should immediately have comment data from initialData
    expect(result.current.comment).toBeTruthy();
    expect(result.current.comment!.author).toBe('patio11');

    // Should still load replies
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // After load, comment should be updated from Algolia data
    expect(result.current.replies).toHaveLength(1);
  });

  it('handles Algolia 404 error', async () => {
    server.use(
      http.get(`${ALGOLIA_API}/items/:id`, () => {
        return HttpResponse.json(
          { status: 404, error: 'Item not found' },
          { status: 404 },
        );
      }),
    );

    const { result } = renderHook(() => useCommentDetail(999999999));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.comment).toBeNull();
  });

  it('degrades gracefully when item title fetch fails', async () => {
    // Override only the Firebase handler to fail
    server.use(
      http.get(`${FIREBASE_API}/item/:id.json`, () => {
        return HttpResponse.json(null, { status: 500 });
      }),
    );

    const { result } = renderHook(() => useCommentDetail(1001));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Comment data should still be available (from Algolia)
    expect(result.current.comment).toBeTruthy();
    expect(result.current.replies).toHaveLength(1);
    // Item title should be null (graceful degradation)
    expect(result.current.itemTitle).toBeNull();
    // No error (item title failure is non-blocking)
    expect(result.current.error).toBeNull();
  });

  it('accepts string commentId', async () => {
    const { result } = renderHook(() => useCommentDetail('1001'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.comment).toBeTruthy();
    expect(result.current.comment!.id).toBe(1001);
  });
});

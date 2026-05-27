import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useCommentDetail } from './useCommentDetail';
import { hnSdk } from '../api/hnSdk';
import { server } from '../mocks/server';
import { ALGOLIA_API } from '../config/api';
import type { FirebaseItem } from '../types';

const mockStoryItem: FirebaseItem = {
  id: 12345,
  title: 'Rust Is the Future of JavaScript Infrastructure',
  by: 'leerob',
  score: 284,
  time: Math.floor(Date.now() / 1000) - 3600,
  descendants: 137,
  kids: [1001, 1002, 1003, 1004],
  type: 'story',
};

describe('useCommentDetail', () => {
  beforeEach(() => {
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 12345) return mockStoryItem;
      return null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    // initialData renders synchronously before the async fetch resolves.
    expect(result.current.comment).toBeTruthy();
    expect(result.current.comment!.author).toBe('patio11');

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

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
    // Only the SDK item fetch fails — Algolia (comment + replies) still succeeds.
    vi.spyOn(hnSdk, 'readItem').mockRejectedValue(new Error('SDK error'));

    const { result } = renderHook(() => useCommentDetail(1001));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.comment).toBeTruthy();
    expect(result.current.replies).toHaveLength(1);
    // Item title is non-blocking: missing title must NOT propagate as an error.
    expect(result.current.itemTitle).toBeNull();
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

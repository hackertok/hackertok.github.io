import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useSiblingComments } from './useSiblingComments';
import { server } from '../mocks/server';
import { FIREBASE_API } from '../config/api';

describe('useSiblingComments', () => {
  afterEach(() => {
    server.resetHandlers();
  });

  it('returns the target comment immediately while loading', () => {
    const { result } = renderHook(() => useSiblingComments(1001));

    expect(result.current.siblingIds).toEqual([1001]);
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('accepts string IDs (from URL params)', async () => {
    const { result } = renderHook(() => useSiblingComments('1001'));

    expect(result.current.siblingIds).toEqual([1001]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.siblingIds).toEqual([1001, 1002, 1003]);
    expect(result.current.currentIndex).toBe(0);
  });

  it('fetches siblings from parent kids list', async () => {
    // Default MSW handlers: 1001's parent is 12345, whose kids = [1001, 1002, 1003].
    const { result } = renderHook(() => useSiblingComments(1001));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.siblingIds).toEqual([1001, 1002, 1003]);
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('sets correct currentIndex for non-first sibling', async () => {
    const { result } = renderHook(() => useSiblingComments(1002));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.siblingIds).toEqual([1001, 1002, 1003]);
    expect(result.current.currentIndex).toBe(1);
  });

  it('returns single comment when parent_id is null', async () => {
    server.use(
      http.get(`${FIREBASE_API}/item/:id.json`, ({ params }) => {
        const id = parseInt(params.id as string, 10);
        if (id === 7777) {
          return HttpResponse.json({
            id: 7777,
            by: 'someone',
            text: 'A top-level comment.',
            time: Math.floor(Date.now() / 1000) - 300,
            type: 'comment',
            // omitted parent → top-level
          });
        }
        return HttpResponse.json(null);
      }),
    );

    const { result } = renderHook(() => useSiblingComments(7777));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.siblingIds).toEqual([7777]);
    expect(result.current.currentIndex).toBe(0);
  });

  it('returns single comment when parent has no kids', async () => {
    server.use(
      http.get(`${FIREBASE_API}/item/:id.json`, ({ params }) => {
        const id = parseInt(params.id as string, 10);
        if (id === 8888) {
          return HttpResponse.json({
            id: 8888,
            by: 'test',
            text: 'Lone comment.',
            time: Math.floor(Date.now() / 1000) - 100,
            parent: 9999,
            type: 'comment',
          });
        }
        if (id === 9999) {
          // Parent without `kids` → siblings should fall back to [self].
          return HttpResponse.json({
            id: 9999,
            title: 'A Story',
            by: 'poster',
            type: 'story',
          });
        }
        return HttpResponse.json(null);
      }),
    );

    const { result } = renderHook(() => useSiblingComments(8888));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.siblingIds).toEqual([8888]);
    expect(result.current.currentIndex).toBe(0);
  });

  it('sets error on fetch failure', async () => {
    server.use(
      http.get(`${FIREBASE_API}/item/:id.json`, () => {
        return HttpResponse.json(
          { status: 500, error: 'Server Error' },
          { status: 500 },
        );
      }),
    );

    const { result } = renderHook(() => useSiblingComments(999));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('sets error on network failure', async () => {
    server.use(
      http.get(`${FIREBASE_API}/item/:id.json`, () => {
        return HttpResponse.error();
      }),
    );

    const { result } = renderHook(() => useSiblingComments(1001));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('aborts in-flight fetches on unmount', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

    const { unmount } = renderHook(() => useSiblingComments(1001));

    unmount();

    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it('refetches when commentId changes', async () => {
    const { result, rerender } = renderHook(
      ({ id }) => useSiblingComments(id),
      { initialProps: { id: 1001 as number | string } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.siblingIds).toEqual([1001, 1002, 1003]);

    server.use(
      http.get(`${FIREBASE_API}/item/:id.json`, ({ params }) => {
        const id = parseInt(params.id as string, 10);
        if (id === 7777) {
          return HttpResponse.json({
            id: 7777,
            by: 'someone',
            text: 'A top-level comment.',
            time: Math.floor(Date.now() / 1000) - 300,
            type: 'comment',
          });
        }
        return HttpResponse.json(null);
      }),
    );

    rerender({ id: 7777 });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.siblingIds).toEqual([7777]);
  });
});

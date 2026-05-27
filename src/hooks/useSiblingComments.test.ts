import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSiblingComments } from './useSiblingComments';
import { hnSdk } from '../api/hnSdk';
import type { FirebaseItem } from '../types';

const mockItems: Record<number, FirebaseItem> = {
  1001: { id: 1001, by: 'patio11', text: 'Great comment', time: Math.floor(Date.now() / 1000) - 1800, parent: 12345, kids: [2001], type: 'comment' },
  1002: { id: 1002, by: 'jgrahamc', text: 'Another comment', time: Math.floor(Date.now() / 1000) - 600, parent: 12345, type: 'comment' },
  1003: { id: 1003, by: 'dang', text: 'Mod comment', time: Math.floor(Date.now() / 1000) - 300, parent: 12345, type: 'comment' },
  1004: { id: 1004, by: 'leerob', text: 'Author comment', time: Math.floor(Date.now() / 1000) - 100, parent: 12345, type: 'comment' },
  12345: { id: 12345, title: 'Sample Story', by: 'poster', score: 100, time: Math.floor(Date.now() / 1000) - 3600, descendants: 137, kids: [1001, 1002, 1003, 1004], type: 'story' },
};

describe('useSiblingComments', () => {
  beforeEach(() => {
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => mockItems[Number(id)] ?? null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the target comment immediately while loading', async () => {
    const { result } = renderHook(() => useSiblingComments(1001));

    expect(result.current.siblingIds).toEqual([1001]);
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    // Let async updates settle to avoid act() warnings
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('accepts string IDs (from URL params)', async () => {
    const { result } = renderHook(() => useSiblingComments('1001'));

    expect(result.current.siblingIds).toEqual([1001]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.siblingIds).toEqual([1001, 1002, 1003, 1004]);
    expect(result.current.currentIndex).toBe(0);
  });

  it('fetches siblings from parent kids list', async () => {
    // Default MSW handlers: 1001's parent is 12345, whose kids = [1001, 1002, 1003, 1004].
    const { result } = renderHook(() => useSiblingComments(1001));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.siblingIds).toEqual([1001, 1002, 1003, 1004]);
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('sets correct currentIndex for non-first sibling', async () => {
    const { result } = renderHook(() => useSiblingComments(1002));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.siblingIds).toEqual([1001, 1002, 1003, 1004]);
    expect(result.current.currentIndex).toBe(1);
  });

  it('returns single comment when parent_id is null', async () => {
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 7777) {
        return { id: 7777, by: 'someone', text: 'A top-level comment.', time: Math.floor(Date.now() / 1000) - 300, type: 'comment' };
      }
      return null;
    });

    const { result } = renderHook(() => useSiblingComments(7777));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.siblingIds).toEqual([7777]);
    expect(result.current.currentIndex).toBe(0);
  });

  it('returns single comment when parent has no kids', async () => {
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 8888) {
        return { id: 8888, by: 'test', text: 'Lone comment.', time: Math.floor(Date.now() / 1000) - 100, parent: 9999, type: 'comment' };
      }
      if (Number(id) === 9999) {
        return { id: 9999, title: 'A Story', by: 'poster', type: 'story' };
      }
      return null;
    });

    const { result } = renderHook(() => useSiblingComments(8888));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.siblingIds).toEqual([8888]);
    expect(result.current.currentIndex).toBe(0);
  });

  it('sets error on fetch failure', async () => {
    vi.spyOn(hnSdk, 'readItem').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSiblingComments(999));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('sets error on network failure', async () => {
    vi.spyOn(hnSdk, 'readItem').mockRejectedValue(new Error('Failed to fetch'));

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
    expect(result.current.siblingIds).toEqual([1001, 1002, 1003, 1004]);

    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 7777) {
        return { id: 7777, by: 'someone', text: 'A top-level comment.', time: Math.floor(Date.now() / 1000) - 300, type: 'comment' };
      }
      return null;
    });

    rerender({ id: 7777 });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.siblingIds).toEqual([7777]);
  });
});

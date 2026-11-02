import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useCommentDetail } from './useCommentDetail';
import { __resetFetchCachesForTests } from '../api/hn';
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
    __resetFetchCachesForTests();
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

  it('reports the item title as loading until its fetch settles', async () => {
    let resolveStory!: (item: FirebaseItem) => void;
    vi.spyOn(hnSdk, 'readItem').mockImplementation(() => new Promise(resolve => { resolveStory = resolve; }));

    const { result } = renderHook(() => useCommentDetail(1001));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.itemTitle).toBeNull();
    expect(result.current.itemTitleLoading).toBe(true);

    resolveStory(mockStoryItem);

    await waitFor(() => {
      expect(result.current.itemTitleLoading).toBe(false);
    });
    expect(result.current.itemTitle).toBe('Rust Is the Future of JavaScript Infrastructure');
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

  it('keeps an Algolia server error as an error without asking Firebase', async () => {
    server.use(
      http.get(`${ALGOLIA_API}/items/:id`, () => new HttpResponse(null, { status: 500 })),
    );
    const readItem = vi.spyOn(hnSdk, 'readItem');

    const { result } = renderHook(() => useCommentDetail(1001));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toMatch(/500/);
    expect(readItem).not.toHaveBeenCalledWith(1001);
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
    await waitFor(() => {
      expect(result.current.itemTitleLoading).toBe(false);
    });
  });

  describe('a flagged reply, which Algolia leaves out of the item tree', () => {
    const now = Math.floor(Date.now() / 1000);
    const flaggedReply: FirebaseItem = {
      id: 2002, type: 'comment', by: 'eve', text: 'Killed text', dead: true, time: now - 800, parent: 1001, kids: [3001],
    };

    function mockStoryComments(response: () => Response | Promise<Response>, firebaseItems: FirebaseItem[] = [flaggedReply]) {
      server.use(
        http.get(`${ALGOLIA_API}/search`, ({ request }) =>
          new URL(request.url).searchParams.get('tags') === 'comment,story_12345' ? response() : HttpResponse.json({ hits: [], nbHits: 0, nbPages: 0 })),
      );
      vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
        if (Number(id) === 12345) return mockStoryItem;
        return firebaseItems.find(item => item.id === Number(id)) ?? null;
      });
    }

    it('adds it with its replies once the story comments load', async () => {
      mockStoryComments(() => HttpResponse.json({
        hits: [
          { objectID: '1001', author: 'patio11', comment_text: 'Root', created_at_i: now - 1800, parent_id: 12345 },
          { objectID: '2001', author: 'tptacek', comment_text: 'Live reply', created_at_i: now - 900, parent_id: 1001 },
          { objectID: '3001', author: 'mallory', comment_text: 'Reply to a flagged comment', created_at_i: now - 700, parent_id: 2002 },
        ],
        nbHits: 3,
        nbPages: 1,
      }));

      const { result } = renderHook(() => useCommentDetail(1001));

      await waitFor(() => {
        expect(result.current.replies.map(c => c.id)).toEqual([2001, 2002]);
      });
      expect(result.current.replies[1]).toMatchObject({ author: 'eve', text: '[flagged]' });
      expect(result.current.replies[1].children.map(c => c.id)).toEqual([3001]);
      expect(result.current.error).toBeNull();
    });

    it("keeps Algolia's replies when the story comments fail to load", async () => {
      let served = false;
      mockStoryComments(() => {
        served = true;
        return new HttpResponse(null, { status: 503 });
      });

      const { result } = renderHook(() => useCommentDetail(1001));

      await waitFor(() => {
        expect(served).toBe(true);
        expect(result.current.moreRepliesLoading).toBe(false);
      });
      expect(result.current.replies.map(c => c.id)).toEqual([2001]);
      expect(result.current.error).toBeNull();
    });

    it("waits for them when they're a comment's only replies", async () => {
      let serve!: () => void;
      const served = new Promise<void>(resolve => { serve = resolve; });
      mockStoryComments(async () => {
        await served;
        return HttpResponse.json({
          hits: [
            { objectID: '1002', author: 'jgrahamc', comment_text: 'Root', created_at_i: now - 1200, parent_id: 12345 },
            { objectID: '3001', author: 'mallory', comment_text: 'Reply to a flagged comment', created_at_i: now - 700, parent_id: 2002 },
          ],
          nbHits: 2,
          nbPages: 1,
        });
      }, [
        { id: 1002, type: 'comment', by: 'jgrahamc', text: 'Root', time: now - 1200, parent: 12345, kids: [2002] },
        { ...flaggedReply, parent: 1002 },
      ]);

      const { result } = renderHook(() => useCommentDetail(1002));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(result.current.replies).toEqual([]);
      expect(result.current.moreRepliesLoading).toBe(true);

      serve();
      await waitFor(() => {
        expect(result.current.moreRepliesLoading).toBe(false);
      });
      expect(result.current.replies.map(c => c.id)).toEqual([2002]);
      expect(result.current.replies[0].children.map(c => c.id)).toEqual([3001]);
    });

    it('settles a comment with no replies without reading the story', async () => {
      let served = false;
      mockStoryComments(() => {
        served = true;
        return HttpResponse.json({ hits: [], nbHits: 0, nbPages: 0 });
      }, [{ id: 1003, type: 'comment', by: 'dang', text: 'Root', time: now - 600, parent: 12345 }]);

      const { result } = renderHook(() => useCommentDetail(1003));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.moreRepliesLoading).toBe(false);
      });
      expect(result.current.replies).toEqual([]);
      expect(served).toBe(false);
    });
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

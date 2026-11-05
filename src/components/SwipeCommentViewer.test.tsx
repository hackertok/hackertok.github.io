import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '../test/test-utils';
import { SwipeCommentViewer } from './SwipeCommentViewer';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { hnSdk } from '../api/hnSdk';
import { __resetFetchCachesForTests } from '../api/hn';
import { mockAlgoliaCommentItem1003 } from '../mocks/handlers';
import { ALGOLIA_API } from '../config/api';
import type { FirebaseItem } from '../types';

// SwipeCommentViewer uses window.innerWidth for scroll calculations.
// jsdom defaults to 0, so set a meaningful width for virtualization tests.
Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });

// jsdom doesn't implement Element.prototype.scrollTo
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
});

const defaultItems: Record<number, FirebaseItem> = {
  1001: { id: 1001, by: 'patio11', text: 'The wasm-bindgen approach is really interesting.', time: Math.floor(Date.now() / 1000) - 1800, parent: 12345, kids: [2001], type: 'comment' },
  1002: { id: 1002, by: 'jgrahamc', text: 'Great point about performance.', time: Math.floor(Date.now() / 1000) - 600, parent: 12345, type: 'comment' },
  1003: { id: 1003, by: 'dang', text: 'Worth reading the follow-up.', time: Math.floor(Date.now() / 1000) - 300, parent: 12345, type: 'comment' },
  1004: { id: 1004, by: 'leerob', text: 'Author here — thanks!', time: Math.floor(Date.now() / 1000) - 100, parent: 12345, type: 'comment' },
  12345: { id: 12345, title: 'Rust Is the Future of JavaScript Infrastructure', by: 'leerob', score: 284, time: Math.floor(Date.now() / 1000) - 3600, descendants: 137, kids: [1001, 1002, 1003, 1004], type: 'story' },
};

describe('SwipeCommentViewer', () => {
  beforeEach(() => {
    __resetFetchCachesForTests();
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => defaultItems[Number(id)] ?? null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    server.resetHandlers();
  });

  it('renders swipe container with skeleton while loading', async () => {
    render(<SwipeCommentViewer initialCommentId="1001" />, {
      initialEntries: [{ pathname: '/item/1001', state: { isComment: true } }],
    });

    const container = screen.getByTestId('swipe-container');
    expect(container).toBeInTheDocument();

    const panels = screen.getAllByTestId('swipe-panel');
    expect(panels.length).toBeGreaterThanOrEqual(1);

    // Let async updates settle to avoid act() warnings
    await waitFor(() => {
      expect(screen.getAllByTestId('swipe-panel').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('does not throw on a back-forward cache restore with site storage blocked', async () => {
    window.scrollTo = vi.fn();
    render(<SwipeCommentViewer initialCommentId="1001" />, {
      initialEntries: [{ pathname: '/item/1001', state: { isComment: true } }],
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('swipe-panel')).toHaveLength(4);
    });

    // Blocking site data makes the `sessionStorage` getter itself throw.
    const storage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')!;
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); },
    });
    const onError = vi.fn((event: ErrorEvent) => event.preventDefault());
    window.addEventListener('error', onError);
    try {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    } finally {
      window.removeEventListener('error', onError);
      Object.defineProperty(globalThis, 'sessionStorage', storage);
    }

    expect(onError).not.toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('restores the offset on a back-forward cache restore over 30 minutes later', async () => {
    window.scrollTo = vi.fn();
    render(<SwipeCommentViewer initialCommentId="1001" />, {
      initialEntries: [{ pathname: '/item/1001', state: { isComment: true } }],
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('swipe-panel')).toHaveLength(4);
    });

    const now = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const scrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });
    try {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      nowSpy.mockReturnValue(now + 31 * 60 * 1000);
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    } finally {
      nowSpy.mockRestore();
      if (scrollY) Object.defineProperty(window, 'scrollY', scrollY);
      else delete (window as { scrollY?: unknown }).scrollY;
    }

    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 500);
  });

  it('renders sibling comment panels after loading', async () => {
    render(<SwipeCommentViewer initialCommentId="1001" />, {
      initialEntries: [{ pathname: '/item/1001', state: { isComment: true } }],
    });

    // Parent 12345 has kids: [1001, 1002, 1003, 1004] → 4 panels.
    await waitFor(() => {
      const panels = screen.getAllByTestId('swipe-panel');
      expect(panels.length).toBe(4);
    });

    await waitFor(() => {
      expect(screen.getByText('patio11')).toBeInTheDocument();
    });
  });

  it('shows error state when Firebase fetch fails', async () => {
    vi.spyOn(hnSdk, 'readItem').mockRejectedValue(new Error('Server Error'));

    render(<SwipeCommentViewer initialCommentId="999" />, {
      initialEntries: [{ pathname: '/item/999', state: { isComment: true } }],
    });

    // 30s waitFor + 35s test timeout cover the 2+4+8s auto-retry backoff.
    await waitFor(() => {
      expect(screen.getByText('Failed to load comments')).toBeInTheDocument();
    }, { timeout: 30000 });
  }, 35000);

  it('renders single panel when comment has no parent', async () => {
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 7777) {
        return { id: 7777, by: 'solo', text: 'Top-level comment with no parent.', time: Math.floor(Date.now() / 1000) - 300, type: 'comment' };
      }
      return null;
    });

    server.use(
      // FullScreenComment's useCommentDetail hits Algolia.
      http.get(`${ALGOLIA_API}/items/:id`, () => {
        return HttpResponse.json({
          id: 7777,
          type: 'comment',
          author: 'solo',
          text: 'Top-level comment with no parent.',
          created_at_i: Math.floor(Date.now() / 1000) - 300,
          parent_id: null,
          story_id: null,
          children: [],
        });
      }),
    );

    render(<SwipeCommentViewer initialCommentId="7777" />, {
      initialEntries: [{ pathname: '/item/7777', state: { isComment: true } }],
    });

    await waitFor(() => {
      expect(screen.getByText('solo')).toBeInTheDocument();
    });

    const panels = screen.getAllByTestId('swipe-panel');
    expect(panels.length).toBe(1);
  });

  it('virtualizes panels beyond BUFFER distance', async () => {
    // 7 kids exercises the BUFFER=±2 boundary: 3 real, 4 skeleton.
    const manyKids = [3001, 3002, 3003, 3004, 3005, 3006, 3007];

    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 50000) {
        return { id: 50000, title: 'Big Thread', by: 'poster', type: 'story', kids: manyKids };
      }
      return {
        id: Number(id), by: `user${id}`, text: `Comment ${id}`, time: Math.floor(Date.now() / 1000) - 300, parent: 50000, type: 'comment',
      };
    });

    server.use(
      http.get(`${ALGOLIA_API}/items/:id`, ({ params }) => {
        const id = parseInt(params.id as string, 10);
        return HttpResponse.json({
          id,
          type: 'comment',
          author: `user${id}`,
          text: `Comment ${id}`,
          created_at_i: Math.floor(Date.now() / 1000) - 300,
          parent_id: 50000,
          story_id: 50000,
          children: [],
        });
      }),
    );

    render(<SwipeCommentViewer initialCommentId="3001" />, {
      initialEntries: [{ pathname: '/item/3001', state: { isComment: true } }],
    });

    await waitFor(() => {
      const panels = screen.getAllByTestId('swipe-panel');
      expect(panels.length).toBe(7);
    });

    await waitFor(() => {
      expect(screen.getByText('user3001')).toBeInTheDocument();
    });

    // currentIndex=0 + BUFFER=2 → panels 0-2 real, 3-6 skeleton.
    const panels = screen.getAllByTestId('swipe-panel');
    // Panel 0 stays in PageStage's 'transitioning' state for ~1200ms
    // after loading flips false, so .skeleton-overlay lingers — wait
    // for it to unmount ('done' state) before asserting "fully cleared".
    await waitFor(
      () => {
        expect(panels[0].querySelector('.skeleton-overlay')).toBeNull();
      },
      { timeout: 2000 },
    );
    expect(panels[0].querySelector('.animate-pulse')).toBeNull();
    // Panel 3 sits exactly at distance BUFFER+1 — boundary check.
    expect(panels[3].querySelector('.animate-pulse')).not.toBeNull();
    expect(panels[4].querySelector('.animate-pulse')).not.toBeNull();
    expect(panels[5].querySelector('.animate-pulse')).not.toBeNull();
    expect(panels[6].querySelector('.animate-pulse')).not.toBeNull();
  });

  // Renders the viewer on its route, with a Back button, and returns every
  // pathname the route lands on.
  function renderViewerRoute(pathnames: string[]) {
    const paths: string[] = [];
    function PathLog() {
      const { pathname } = useLocation();
      useEffect(() => {
        paths.push(pathname);
      }, [pathname]);
      return null;
    }
    function BackButton() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => void navigate(-1)}>Back</button>;
    }
    function ViewerRoute() {
      return <SwipeCommentViewer initialCommentId={useParams().id!} />;
    }

    render(
      <>
        <PathLog />
        <BackButton />
        <Routes>
          <Route path="/item/:id" element={<ViewerRoute />} />
        </Routes>
      </>,
      { initialEntries: pathnames.map(pathname => ({ pathname, state: { isComment: true } })) },
    );
    return paths;
  }

  const activePanelId = () => document.querySelector('.swipe-snap-panel.active')?.getAttribute('data-item-id');

  it('stays on the parent after its "parent" link, without going back to the reply', async () => {
    const reply = { id: 2001, by: 'tptacek', text: 'Agreed.', time: Math.floor(Date.now() / 1000) - 900, parent: 1001, type: 'comment' } satisfies FirebaseItem;
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => (Number(id) === 2001 ? reply : defaultItems[Number(id)] ?? null));
    server.use(
      http.get(`${ALGOLIA_API}/items/2001`, () => HttpResponse.json({
        id: 2001, type: 'comment', author: 'tptacek', text: 'Agreed.', created_at_i: reply.time,
        parent_id: 1001, story_id: 12345, children: [],
      })),
    );

    const paths = renderViewerRoute(['/item/2001']);

    fireEvent.click(await screen.findByRole('link', { name: 'parent' }));

    // 1001's siblings: [1001, 1002, 1003, 1004].
    await waitFor(() => {
      expect(screen.getAllByTestId('swipe-panel')).toHaveLength(4);
    });
    await waitFor(() => {
      expect(screen.getByText('patio11')).toBeInTheDocument();
    });
    expect(paths).toEqual(['/item/2001', '/item/1001']);
  });

  it('lands on the reply after Back from its parent, without rewriting history', async () => {
    const time = Math.floor(Date.now() / 1000) - 200;
    const replyIds = [3101, 3102, 3103];
    const items: Record<number, FirebaseItem> = {
      ...defaultItems,
      1003: { ...defaultItems[1003], kids: replyIds },
      ...Object.fromEntries(replyIds.map(id => [id, { id, by: `user${id}`, text: 'Reply.', time, parent: 1003, type: 'comment' }])),
    };
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => items[Number(id)] ?? null);
    server.use(
      http.get(`${ALGOLIA_API}/items/:id`, ({ params }) => {
        const id = Number(params.id);
        if (!replyIds.includes(id)) return;
        return HttpResponse.json({
          id, type: 'comment', author: `user${id}`, text: 'Reply.', created_at_i: time,
          parent_id: 1003, story_id: 12345, children: [],
        });
      }),
    );

    // On 1003, third of [1001, 1002, 1003, 1004], with its first reply behind it.
    const paths = renderViewerRoute(['/item/3101', '/item/1003']);
    await waitFor(() => {
      expect(screen.getAllByTestId('swipe-panel')).toHaveLength(4);
      expect(activePanelId()).toBe('1003');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => {
      expect(screen.getAllByTestId('swipe-panel')).toHaveLength(3);
      expect(activePanelId()).toBe('3101');
    });
    expect(paths).toEqual(['/item/1003', '/item/3101']);
  });

  it('shows the comment it was opened on while its siblings load, and keeps it when they land', async () => {
    let releaseParent!: () => void;
    const parentRead = new Promise<void>(resolve => { releaseParent = resolve; });
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 12345) await parentRead;
      return defaultItems[Number(id)] ?? null;
    });
    let commentFetches = 0;
    server.use(
      http.get(`${ALGOLIA_API}/items/1003`, () => {
        commentFetches++;
        return HttpResponse.json(mockAlgoliaCommentItem1003);
      }),
    );

    render(<SwipeCommentViewer initialCommentId="1003" />, {
      initialEntries: [{ pathname: '/item/1003', state: { isComment: true } }],
    });

    expect(await screen.findByText(mockAlgoliaCommentItem1003.text)).toBeInTheDocument();
    expect(screen.getAllByTestId('swipe-panel')).toHaveLength(1);
    expect(activePanelId()).toBe('1003');

    window.scrollTo = vi.fn();
    releaseParent();

    // Third of [1001, 1002, 1003, 1004].
    await waitFor(() => {
      expect(screen.getAllByTestId('swipe-panel')).toHaveLength(4);
    });
    expect(activePanelId()).toBe('1003');
    expect(screen.getByText(mockAlgoliaCommentItem1003.text)).toBeInTheDocument();
    expect(commentFetches).toBe(1);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('loads the swipe\'s next stops past a deleted sibling, and not the deleted one', async () => {
    const items: Record<number, FirebaseItem> = {
      ...defaultItems,
      3001: { id: 3001, type: 'comment', deleted: true, parent: 12345, time: Math.floor(Date.now() / 1000) - 500 },
      12345: { ...defaultItems[12345], kids: [1001, 3001, 1002, 1003, 1004] },
    };
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => items[Number(id)] ?? null);

    render(<SwipeCommentViewer initialCommentId="1001" />, {
      initialEntries: [{ pathname: '/item/1001', state: { isComment: true } }],
    });

    // 1003 is three panels on, but the second stop.
    const panel1003 = () => document.querySelector('[data-item-id="1003"]')!;
    await waitFor(() => {
      expect(panel1003().textContent).toContain(mockAlgoliaCommentItem1003.text);
    });
    expect(document.querySelector('[data-item-id="3001"] .animate-pulse')).not.toBeNull();
  });

  it('stays on the comment it was opened on, without mounting it again, when its siblings load on a retry', async () => {
    let parentReads = 0;
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => {
      if (Number(id) === 12345 && parentReads++ === 0) throw new Error('Network error');
      return defaultItems[Number(id)] ?? null;
    });
    let commentFetches = 0;
    server.use(
      http.get(`${ALGOLIA_API}/items/1003`, () => {
        commentFetches++;
        return HttpResponse.json(mockAlgoliaCommentItem1003);
      }),
    );

    render(<SwipeCommentViewer initialCommentId="1003" />, {
      initialEntries: [{ pathname: '/item/1003', state: { isComment: true } }],
    });
    expect(await screen.findByText(mockAlgoliaCommentItem1003.text)).toBeInTheDocument();
    const panel = document.querySelector('[data-item-id="1003"]');

    // The retry waits out a 2s backoff.
    await waitFor(() => {
      expect(screen.getAllByTestId('swipe-panel')).toHaveLength(4);
      expect(activePanelId()).toBe('1003');
    }, { timeout: 5000 });
    expect(document.querySelector('[data-item-id="1003"]')).toBe(panel);
    expect(commentFetches).toBe(1);
  }, 10000);

  it('sets data-item-id on each panel', async () => {
    render(<SwipeCommentViewer initialCommentId="1001" />, {
      initialEntries: [{ pathname: '/item/1001', state: { isComment: true } }],
    });

    await waitFor(() => {
      const panels = screen.getAllByTestId('swipe-panel');
      expect(panels.length).toBe(4);
    });

    const panels = screen.getAllByTestId('swipe-panel');
    expect(panels[0]).toHaveAttribute('data-item-id', '1001');
    expect(panels[1]).toHaveAttribute('data-item-id', '1002');
    expect(panels[2]).toHaveAttribute('data-item-id', '1003');
    expect(panels[3]).toHaveAttribute('data-item-id', '1004');
  });
});

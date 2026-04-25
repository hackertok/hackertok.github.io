import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useUserProfile,
  __resetUserProfileCacheForTests,
  __getUserProfileCacheForTests,
} from './useUserProfile';
import type { UserProfile } from '../types';

function profileBody(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'pg',
    created: 1160418092,
    karma: 155555,
    about: '<p>Hi.</p>',
    submitted: [1, 2, 3],
    ...overrides,
  };
}

// Mirrors the helper in useUserInfiniteStories.test.ts. fetch's input can be a
// string, URL, or Request — covering all three keeps lint quiet about
// "[object Object]" stringification on the Request branch.
function fetchInputToUrl(input: RequestInfo | URL | undefined): string {
  if (!input) return '';
  if (input instanceof URL) return input.href;
  if (typeof input === 'string') return input;
  return input.url;
}

describe('useUserProfile', () => {
  beforeEach(() => {
    __resetUserProfileCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a user profile on mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(profileBody())),
    );

    const { result } = renderHook(() => useUserProfile('pg'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.profile?.id).toBe('pg');
    expect(result.current.profile?.karma).toBe(155555);
    expect(result.current.error).toBeNull();
    expect(result.current.isNotFound).toBe(false);
  });

  it('treats Firebase null as NotFound (isNotFound=true) and surfaces the error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('null', { status: 200 }),
    );

    const { result } = renderHook(() => useUserProfile('nope'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.profile).toBeNull();
    expect(result.current.isNotFound).toBe(true);
    expect(result.current.error).toMatch(/not found/i);
  });

  it('surfaces a generic error on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Service Unavailable', { status: 503 }),
    );

    const { result } = renderHook(() => useUserProfile('pg'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatch(/503/);
    expect(result.current.isNotFound).toBe(false);
    expect(result.current.profile).toBeNull();
  });

  it('preserves username case (HN is case-sensitive)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(profileBody({ id: 'PaulG' }))),
    );

    const { result } = renderHook(() => useUserProfile('PaulG'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.profile?.id).toBe('PaulG');
    const url = fetchSpy.mock.calls[0]?.[0];
    expect(typeof url === 'string' ? url : (url as URL).href).toMatch(/\/user\/PaulG\.json/);
  });

  describe('cache', () => {
    it('returns cached profile synchronously on remount and skips the fetch', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify(profileBody())));

      const first = renderHook(() => useUserProfile('pg'));
      await waitFor(() => expect(first.result.current.loading).toBe(false));
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      first.unmount();
      fetchSpy.mockClear();

      const second = renderHook(() => useUserProfile('pg'));

      expect(second.result.current.loading).toBe(false);
      expect(second.result.current.profile?.id).toBe('pg');

      await Promise.resolve();
      await Promise.resolve();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not cache failed responses', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Service Unavailable', { status: 503 }),
      );

      const { result, unmount } = renderHook(() => useUserProfile('pg'));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toMatch(/503/);

      unmount();
      expect(__getUserProfileCacheForTests().has('pg')).toBe(false);
    });

    it('does not cache NotFound responses', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('null', { status: 200 }),
      );

      const { result, unmount } = renderHook(() => useUserProfile('nope'));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.isNotFound).toBe(true);

      unmount();
      expect(__getUserProfileCacheForTests().has('nope')).toBe(false);
    });
  });

  describe('username change', () => {
    it('discards stale state when username changes between renders', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = fetchInputToUrl(input);
        const id = /\/user\/([^/]+)\.json/.exec(url)?.[1] ?? '';
        return Promise.resolve(
          new Response(JSON.stringify(profileBody({ id, karma: id === 'pg' ? 1 : 2 }))),
        );
      });

      const { result, rerender } = renderHook(
        ({ username }: { username: string }) => useUserProfile(username),
        { initialProps: { username: 'pg' } },
      );

      await waitFor(() => expect(result.current.profile?.id).toBe('pg'));

      rerender({ username: 'dang' });
      await waitFor(() => expect(result.current.profile?.id).toBe('dang'));
      expect(result.current.profile?.karma).toBe(2);
    });

    // Pins the `versionRef` invalidation logic on lines 86, 91, 98, 106. The
    // existing "discards stale state" test exercises a sequential race where
    // each fetch resolves before the next one starts; this test exercises
    // the actual interleaving — fetch A is in-flight when username changes,
    // fetch B resolves first, then fetch A resolves. Without `versionRef`,
    // fetch A's `setProfile` would clobber B's data because `setProfile`
    // doesn't otherwise know its caller is stale. Both `if (versionRef.current
    // !== currentVersion) return` guards must hold for B's data to survive.
    it('does not commit a stale in-flight response when username changes mid-fetch', async () => {
      // Manual deferred promises so the test controls resolution order
      // independently of the rerender — a real concurrent network race.
      let resolvePg!: (response: Response) => void;
      const pgPromise = new Promise<Response>((resolve) => {
        resolvePg = resolve;
      });
      const dangResponse = new Response(JSON.stringify(profileBody({ id: 'dang', karma: 999 })));

      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = fetchInputToUrl(input);
        const id = /\/user\/([^/]+)\.json/.exec(url)?.[1] ?? '';
        if (id === 'pg') return pgPromise;
        return Promise.resolve(dangResponse.clone());
      });

      const { result, rerender } = renderHook(
        ({ username }: { username: string }) => useUserProfile(username),
        { initialProps: { username: 'pg' } },
      );

      // pg's fetch is in-flight (still pending) — switch to dang BEFORE
      // pg resolves. The hook's prop-derived state pattern bumps versionRef
      // synchronously and immediately starts dang's fetch.
      expect(result.current.loading).toBe(true);

      rerender({ username: 'dang' });

      // dang resolves first → state should reflect dang.
      await waitFor(() => expect(result.current.profile?.id).toBe('dang'));
      expect(result.current.profile?.karma).toBe(999);

      // Now resolve pg's stale promise. Without invalidation, pg's data
      // would overwrite dang's. With invalidation, both `versionRef` guards
      // (after `await fetch` and after `await response.json`) short-circuit
      // and pg's data is dropped.
      await act(async () => {
        resolvePg(new Response(JSON.stringify(profileBody({ id: 'pg', karma: 1 }))));
        // Microtasks must flush so any (incorrect) setProfile would commit.
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.profile?.id).toBe('dang');
      expect(result.current.profile?.karma).toBe(999);
      // Cache should also reflect only dang — pg's stale write is suppressed.
      expect(__getUserProfileCacheForTests().get('pg')).toBeUndefined();
      expect(__getUserProfileCacheForTests().get('dang')?.karma).toBe(999);
    });
  });

  describe('refresh', () => {
    it('clears the cache entry and re-fetches', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify(profileBody({ karma: 100 }))))
        .mockResolvedValueOnce(new Response(JSON.stringify(profileBody({ karma: 200 }))));

      const { result } = renderHook(() => useUserProfile('pg'));
      await waitFor(() => expect(result.current.profile?.karma).toBe(100));

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.profile?.karma).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('empty username', () => {
    it('does not fetch and stays in idle state', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify(profileBody())));

      const { result } = renderHook(() => useUserProfile(''));

      expect(result.current.loading).toBe(false);
      expect(result.current.profile).toBeNull();

      await Promise.resolve();
      await Promise.resolve();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useUserProfile,
  __resetUserProfileCacheForTests,
  __getUserProfileCacheForTests,
} from './useUserProfile';
import { hnSdk } from '../api/hnSdk';
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

describe('useUserProfile', () => {
  beforeEach(() => {
    __resetUserProfileCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a user profile on mount', async () => {
    vi.spyOn(hnSdk, 'readUser').mockResolvedValue(profileBody());

    const { result } = renderHook(() => useUserProfile('pg'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.profile?.id).toBe('pg');
    expect(result.current.profile?.karma).toBe(155555);
    expect(result.current.error).toBeNull();
    expect(result.current.isNotFound).toBe(false);
  });

  it('treats null return as NotFound (isNotFound=true) and surfaces the error', async () => {
    vi.spyOn(hnSdk, 'readUser').mockResolvedValue(null);

    const { result } = renderHook(() => useUserProfile('nope'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.profile).toBeNull();
    expect(result.current.isNotFound).toBe(true);
    expect(result.current.error).toMatch(/not found/i);
  });

  it('surfaces a generic error on SDK rejection', async () => {
    vi.spyOn(hnSdk, 'readUser').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useUserProfile('pg'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatch(/Network error/);
    expect(result.current.isNotFound).toBe(false);
    expect(result.current.profile).toBeNull();
  });

  it('preserves username case (HN is case-sensitive)', async () => {
    const spy = vi.spyOn(hnSdk, 'readUser').mockResolvedValue(profileBody({ id: 'PaulG' }));

    const { result } = renderHook(() => useUserProfile('PaulG'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.profile?.id).toBe('PaulG');
    expect(spy).toHaveBeenCalledWith('PaulG');
  });

  describe('cache', () => {
    it('returns cached profile synchronously on remount and skips the fetch', async () => {
      const spy = vi.spyOn(hnSdk, 'readUser').mockResolvedValue(profileBody());

      const first = renderHook(() => useUserProfile('pg'));
      await waitFor(() => expect(first.result.current.loading).toBe(false));
      expect(spy).toHaveBeenCalledTimes(1);

      first.unmount();
      spy.mockClear();

      const second = renderHook(() => useUserProfile('pg'));

      expect(second.result.current.loading).toBe(false);
      expect(second.result.current.profile?.id).toBe('pg');

      await Promise.resolve();
      await Promise.resolve();
      expect(spy).not.toHaveBeenCalled();
    });

    it('does not cache failed responses', async () => {
      vi.spyOn(hnSdk, 'readUser').mockRejectedValue(new Error('Network error'));

      const { result, unmount } = renderHook(() => useUserProfile('pg'));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toMatch(/Network error/);

      unmount();
      expect(__getUserProfileCacheForTests().has('pg')).toBe(false);
    });

    it('does not cache NotFound responses', async () => {
      vi.spyOn(hnSdk, 'readUser').mockResolvedValue(null);

      const { result, unmount } = renderHook(() => useUserProfile('nope'));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.isNotFound).toBe(true);

      unmount();
      expect(__getUserProfileCacheForTests().has('nope')).toBe(false);
    });
  });

  describe('username change', () => {
    it('discards stale state when username changes between renders', async () => {
      vi.spyOn(hnSdk, 'readUser').mockImplementation(async (username) => {
        const id = username;
        return profileBody({ id, karma: id === 'pg' ? 1 : 2 });
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

    it('does not commit a stale in-flight response when username changes mid-fetch', async () => {
      let resolvePg!: (value: UserProfile | null) => void;
      const pgPromise = new Promise<UserProfile | null>((resolve) => {
        resolvePg = resolve;
      });

      vi.spyOn(hnSdk, 'readUser').mockImplementation(async (username) => {
        if (username === 'pg') return pgPromise;
        return profileBody({ id: 'dang', karma: 999 });
      });

      const { result, rerender } = renderHook(
        ({ username }: { username: string }) => useUserProfile(username),
        { initialProps: { username: 'pg' } },
      );

      expect(result.current.loading).toBe(true);

      rerender({ username: 'dang' });

      await waitFor(() => expect(result.current.profile?.id).toBe('dang'));
      expect(result.current.profile?.karma).toBe(999);

      await act(async () => {
        resolvePg(profileBody({ id: 'pg', karma: 1 }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.profile?.id).toBe('dang');
      expect(result.current.profile?.karma).toBe(999);
      expect(__getUserProfileCacheForTests().get('pg')).toBeUndefined();
      expect(__getUserProfileCacheForTests().get('dang')?.karma).toBe(999);
    });
  });

  describe('refresh', () => {
    it('clears the cache entry and re-fetches', async () => {
      const spy = vi.spyOn(hnSdk, 'readUser')
        .mockResolvedValueOnce(profileBody({ karma: 100 }))
        .mockResolvedValueOnce(profileBody({ karma: 200 }));

      const { result } = renderHook(() => useUserProfile('pg'));
      await waitFor(() => expect(result.current.profile?.karma).toBe(100));

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.profile?.karma).toBe(200);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('empty username', () => {
    it('does not fetch and stays in idle state', async () => {
      const spy = vi.spyOn(hnSdk, 'readUser').mockResolvedValue(profileBody());

      const { result } = renderHook(() => useUserProfile(''));

      expect(result.current.loading).toBe(false);
      expect(result.current.profile).toBeNull();

      await Promise.resolve();
      await Promise.resolve();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

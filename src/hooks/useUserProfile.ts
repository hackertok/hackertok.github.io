import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hnSdk } from '../api/hnSdk';
import { NotFoundError } from '../api/hn';
import type { UserProfile } from '../types';

// Module-level profile cache (session-lifetime, not persisted).
const userProfileCache = new Map<string, UserProfile>();

/**
 * @internal Testing helper to reset the module-level cache between tests.
 */
export function __resetUserProfileCacheForTests() {
  userProfileCache.clear();
}

/** @internal Exposes cache for test assertions. */
export function __getUserProfileCacheForTests() {
  return userProfileCache;
}

interface UseUserProfileResult {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  /** True when Firebase returned `null` (no such user). Distinct from `error`. */
  isNotFound: boolean;
  refresh: () => Promise<void>;
}

/**
 * Firebase user profile fetch with cache and not-found handling.
 * Case-sensitive — caller must preserve case from the route param.
 */
export function useUserProfile(username: string): UseUserProfileResult {
  const cached = username ? userProfileCache.get(username) : undefined;

  const [profile, setProfile] = useState<UserProfile | null>(cached ?? null);
  const [loading, setLoading] = useState(!cached && !!username);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [prevUsername, setPrevUsername] = useState(username);

  const versionRef = useRef(0);

  // Prop-derived state: reset when username changes without waiting for an
  // effect. Mirrors `useDomainInfiniteStories`' pattern.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  if (prevUsername !== username) {
    setPrevUsername(username);
    const newCached = username ? userProfileCache.get(username) : undefined;
    setProfile(newCached ?? null);
    setLoading(!newCached && !!username);
    setError(null);
    setIsNotFound(false);
  }

  // Bump version when username changes so in-flight fetches for the old user
  // are discarded. useLayoutEffect (not useEffect) so the bump happens
  // synchronously after commit, before any stale fetch microtask can fire.
  useLayoutEffect(() => {
    versionRef.current += 1;
  }, [username]);

  const load = useCallback(async () => {
    if (!username) return;
    const currentVersion = versionRef.current;
    setLoading(true);
    setError(null);
    setIsNotFound(false);

    try {
      const data = await hnSdk.readUser(username);
      if (versionRef.current !== currentVersion) return;
      if (data === null) {
        throw new NotFoundError(`User ${username} not found`);
      }
      userProfileCache.set(username, data);
      setProfile(data);
    } catch (err) {
      if (versionRef.current !== currentVersion) return;
      if (err instanceof NotFoundError) {
        setIsNotFound(true);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (versionRef.current === currentVersion) {
        setLoading(false);
      }
    }
  }, [username]);

  useEffect(() => {
    if (!username || cached) return;
    void load();
  }, [username, cached, load]);

  const refresh = useCallback(async () => {
    if (username) userProfileCache.delete(username);
    versionRef.current += 1;
    await load();
  }, [username, load]);

  return { profile, loading, error, isNotFound, refresh };
}

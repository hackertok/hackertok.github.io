import { useCallback, useEffect, useRef, useState } from 'react';
import { FIREBASE_API } from '../config/api';
import { NotFoundError } from '../api/hn';
import type { UserProfile } from '../types';

// Module-level cache survives route remounts so navigating
// /user/:id → /submitted/:id → back doesn't re-hit Firebase. Profiles change
// rarely enough that a session-lifetime in-memory map is acceptable; bound
// only by the lifetime of the page (visiting many distinct users in one
// session accumulates entries). Swap to an LRU if memory ever shows up in
// profiling.
const userProfileCache = new Map<string, UserProfile>();

/**
 * @internal Testing helper to reset the module-level cache between tests.
 */
export function __resetUserProfileCacheForTests() {
  userProfileCache.clear();
}

/**
 * @internal Testing helper exposing the module-level cache so tests can
 * assert on cache contents directly.
 */
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
 * Fetches a Hacker News user profile from Firebase. Mirrors the
 * `loading`/`error`/`isNotFound` semantics of {@link useItemWithComments} so
 * `UserProfile.tsx` can reuse the same `StateView` patterns. Lazy-initializes
 * from a module-level cache so route remounts are instant, and treats
 * Firebase's `null` response as a NotFoundError (HN convention).
 *
 * `username` is passed verbatim — Firebase is case-sensitive, so any
 * normalization must happen at the caller (today: the route `/user/:id`
 * whose param preserves case).
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
    versionRef.current += 1;
  }

  const load = useCallback(async () => {
    if (!username) return;
    const currentVersion = versionRef.current;
    setLoading(true);
    setError(null);
    setIsNotFound(false);

    try {
      // Encode the username for URL safety. HN usernames are validated upstream
      // (USERNAME_REGEX in sanitize.ts allows only `[a-zA-Z0-9_-]{2,15}`, all
      // encoding-stable), so this is a no-op on the happy path. It exists for
      // defense-in-depth against hand-crafted URLs whose `:id` decodes to
      // characters that would otherwise truncate the path (e.g. `?` becomes a
      // query string, `#` strips the `.json` suffix, `/` extends the path).
      // Mirrors `useUserInfiniteStories.ts`'s author tag encoding.
      const response = await fetch(`${FIREBASE_API}/user/${encodeURIComponent(username)}.json`);
      if (versionRef.current !== currentVersion) return;
      if (!response.ok) {
        throw new Error(`Failed to fetch user ${username}: ${response.status}`);
      }
      const data = (await response.json()) as UserProfile | null;
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

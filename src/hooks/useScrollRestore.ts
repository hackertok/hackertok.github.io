import { useCallback, useLayoutEffect, useRef } from 'react';
import { useNavigationType, NavigationType } from 'react-router-dom';
import { readScrollPosition, writeScrollPosition } from '../utils/scrollRestore';

/**
 * Lightweight scroll-only session restore for list pages whose data
 * is already in memory on remount (e.g. domain / user submissions,
 * where the in-hook module cache supplies stories synchronously).
 *
 * Gated on the navigation type that brought the user here:
 *
 *   - POP (browser back/forward, page reload, initial load) →
 *     restore the saved scrollY. This is the back-nav use case the
 *     hook exists for.
 *   - PUSH / REPLACE (Link click, `navigate()`) → scroll to top and
 *     IGNORE any saved entry. A fresh navigation to the page should
 *     present a fresh view. Without this gate, clicking
 *     `<Link to="/submitted/X">` after having previously visited
 *     /submitted/X earlier in the tab session would land the user
 *     at the *previous* scroll position — surprising, since they
 *     deliberately navigated to the page.
 *
 * Restores once per `key` *entry*. An entry begins on either:
 *   - mount, or
 *   - a `key` change without remount — `<Route path="/from/*">`
 *     keeps the same `<DomainStories>` instance when the user
 *     navigates `/from/foo` → `/from/bar`, so the hook tracks the
 *     last-restored key (not just a "have we restored" boolean) and
 *     re-restores when `key` shifts under it. Same shape applies to
 *     `<Route path="/submitted/:id">`.
 *
 * For each POP entry, once `ready` becomes true:
 *   - sessionStorage entry present → restore via
 *     `requestAnimationFrame(scrollTo)` (the rAF lets React commit
 *     the list before we scroll; without it, scrollTo could clamp
 *     to a still-collapsing document).
 *   - absent → scroll to top (fresh nav).
 *
 * `useLayoutEffect` runs before paint so the warm-cache path
 * doesn't flash the top of the page.
 *
 * Returns `saveScrollPosition` for the caller to wire into
 * navigation surfaces (StoryCard's `onBeforeNavigate`).
 * Snapshot-on-click captures `window.scrollY` at the moment of
 * navigation, before any navigation-induced layout shift. Saves
 * are unconditional — the gate is on RESTORE, not on SAVE: the
 * user might navigate away via PUSH and later POP back, and that
 * later POP needs the saved value.
 *
 * No-op when `key` is undefined — used by pages that haven't yet
 * resolved their context (e.g. `DomainStories` before the route
 * param canonicalises). The hook still mounts (rules of hooks) but
 * does no storage I/O and the effect bails on the missing key.
 */
export function useScrollRestore(
  key: string | undefined,
  ready: boolean,
): { saveScrollPosition: () => void } {
  const navigationType = useNavigationType();

  // Tracks which key the last entry-action (restore or scroll-to-top)
  // fired for. Storing the key (rather than a boolean) is the
  // load-bearing piece for the param-change-without-remount case: a
  // latch keyed on identity-equal-to-current-key naturally re-arms
  // when the route param shifts. `undefined` = never fired yet.
  const handledKeyRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    if (!key || !ready) return;
    if (handledKeyRef.current === key) return;
    handledKeyRef.current = key;

    if (navigationType !== NavigationType.Pop) {
      // PUSH / REPLACE: deliberate fresh navigation. Ignore the
      // saved entry (it stays in storage so a later POP still
      // restores correctly).
      window.scrollTo(0, 0);
      return;
    }

    // Read inline (rather than caching at mount) so a key change
    // picks up the right entry, and so we don't pay a sessionStorage
    // round-trip on every render via `useRef(readScrollPosition(...))`.
    const saved = readScrollPosition(key);
    if (saved !== null) {
      requestAnimationFrame(() => {
        window.scrollTo(0, saved);
      });
    } else {
      window.scrollTo(0, 0);
    }
  }, [key, ready, navigationType]);

  const saveScrollPosition = useCallback(() => {
    if (!key) return;
    writeScrollPosition(key, window.scrollY);
  }, [key]);

  return { saveScrollPosition };
}

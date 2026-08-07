import { useCallback, useLayoutEffect, useRef } from 'react';
import { useNavigationType, NavigationType } from 'react-router';
import { readScrollPosition, writeScrollPosition } from '../utils/scrollRestore';

/**
 * Scroll-only session restore for list pages with in-memory data.
 *
 * POP nav → restore saved scrollY (or scroll to top if absent).
 * PUSH/REPLACE → scroll to top, ignore saved entry (fresh navigation).
 *
 * Restores once per `key` entry. Tracks the last-restored key (not a
 * boolean) so param-changes-without-remount (e.g. `/from/foo` → `/from/bar`)
 * re-arm correctly.
 *
 * Returns `saveScrollPosition` for snapshot-on-click before navigation.
 * No-op when `key` is undefined (unresolved route param).
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNavigationType, NavigationType } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import { useScrollRestore } from './useScrollRestore';
import {
  writeScrollPosition,
  readScrollPosition,
} from '../utils/scrollRestore';

// Mock react-router-dom's useNavigationType so tests don't need a Router
// context. Tests that don't set the value explicitly get NavigationType.Pop
// (the "browser back / reload / initial load" default the hook restores on).
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return { ...actual, useNavigationType: vi.fn(() => actual.NavigationType.Pop) };
});

const mockedUseNavigationType = vi.mocked(useNavigationType);

describe('useScrollRestore', () => {
  // Module-scoped so the assertion helpers reach it without hauling a
  // typed ref through every test. `vi.restoreAllMocks` in `afterEach`
  // unwinds the spy.
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true,
    });
    // jsdom's window.scrollTo is a no-op; spy on it so we can assert
    // restore intent without depending on layout simulation.
    scrollToSpy = vi.fn();
    vi.spyOn(window, 'scrollTo').mockImplementation(
      scrollToSpy as unknown as typeof window.scrollTo,
    );
    // Default to POP so existing tests (which assert the
    // back-nav/restore path) keep passing.
    mockedUseNavigationType.mockReturnValue(NavigationType.Pop);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  describe('restore on mount (POP navigation)', () => {
    it('scrolls to the saved position when ready is true and storage has an entry', async () => {
      writeScrollPosition('domain:github.com', 1234);

      renderHook(() => useScrollRestore('domain:github.com', true));

      // The actual scrollTo runs inside requestAnimationFrame after the
      // useLayoutEffect commits — wait for it.
      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 1234);
      });
    });

    it('scrolls to the top when no saved entry exists (fresh nav)', async () => {
      renderHook(() => useScrollRestore('domain:never-saved.com', true));

      // Top-scroll is synchronous (no rAF), but useLayoutEffect itself
      // runs after render — flushing micro-tasks is enough.
      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
      });
    });

    it('defers the restore until ready flips from false to true', async () => {
      writeScrollPosition('domain:github.com', 500);

      const { rerender } = renderHook(
        ({ ready }) => useScrollRestore('domain:github.com', ready),
        { initialProps: { ready: false } },
      );

      // Cold-load phase: no scroll yet.
      expect(scrollToSpy).not.toHaveBeenCalled();

      rerender({ ready: true });

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 500);
      });
    });

    it('restores at most once per key even if ready churns true→false→true', async () => {
      writeScrollPosition('domain:github.com', 500);

      const { rerender } = renderHook(
        ({ ready }) => useScrollRestore('domain:github.com', ready),
        { initialProps: { ready: true } },
      );

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledTimes(1);
      });

      rerender({ ready: false });
      rerender({ ready: true });

      // Still only one call — the per-key restore latch holds.
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
    });

    it('re-restores when the key changes without remount (route param swap)', async () => {
      // `<Route path="/from/*">` keeps the same `<DomainStories>`
      // instance when `:domain` shifts (e.g. clicking a domain pill on
      // foo for a bar-hosted hit). The restore latch is keyed on the
      // string, not a one-shot bool, so each new entry gets its own
      // restore.
      writeScrollPosition('domain:foo.com', 100);
      writeScrollPosition('domain:bar.com', 500);

      const { rerender } = renderHook(
        ({ key }) => useScrollRestore(key, true),
        { initialProps: { key: 'domain:foo.com' } },
      );

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 100);
      });

      rerender({ key: 'domain:bar.com' });

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 500);
      });
      expect(scrollToSpy).toHaveBeenCalledTimes(2);
    });

    it('treats a stored 0 as a real restored value (not as fresh nav)', async () => {
      // The fresh-nav branch calls scrollTo(0, 0) synchronously; the
      // restored-0 branch defers via requestAnimationFrame. Spy on rAF
      // to distinguish: if 0 was treated as fresh nav, no rAF would be
      // scheduled. (Without this assertion the test would pass even if
      // we ignored the stored 0 — both paths happen to call scrollTo
      // with the same args.)
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
      writeScrollPosition('user:pg', 0);

      renderHook(() => useScrollRestore('user:pg', true));

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
      });
      expect(rafSpy).toHaveBeenCalled();
    });

    it('is a no-op when key is undefined (no read, no scroll)', () => {
      writeScrollPosition('domain:github.com', 500);

      renderHook(() => useScrollRestore(undefined, true));

      expect(scrollToSpy).not.toHaveBeenCalled();
    });
  });

  describe('PUSH / REPLACE navigation (fresh nav)', () => {
    it('ignores the saved entry on PUSH and scrolls to top instead', async () => {
      // Repro of the user-reported bug: after visiting /submitted/X,
      // backing out, navigating elsewhere, then PUSHing back to
      // /submitted/X via a Link click — the page should present
      // fresh, not jump to the previously-saved scroll position.
      mockedUseNavigationType.mockReturnValue(NavigationType.Push);
      writeScrollPosition('user:pg', 500);

      renderHook(() => useScrollRestore('user:pg', true));

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
      });
      expect(scrollToSpy).not.toHaveBeenCalledWith(0, 500);
    });

    it('ignores the saved entry on REPLACE and scrolls to top instead', async () => {
      mockedUseNavigationType.mockReturnValue(NavigationType.Replace);
      writeScrollPosition('user:pg', 500);

      renderHook(() => useScrollRestore('user:pg', true));

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
      });
      expect(scrollToSpy).not.toHaveBeenCalledWith(0, 500);
    });

    it('does NOT delete the saved entry on PUSH (a later POP must still restore)', async () => {
      // The gate is on RESTORE, not on storage. Wiping the entry
      // when the user PUSHes to the page would break the next POP
      // back to the same page.
      mockedUseNavigationType.mockReturnValue(NavigationType.Push);
      writeScrollPosition('user:pg', 500);

      renderHook(() => useScrollRestore('user:pg', true));

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
      });
      expect(readScrollPosition('user:pg')).toBe(500);
    });

    it('uses the latest navigationType when the key changes mid-mount', async () => {
      // Param-change-without-remount + nav-type swap. User on
      // /from/foo (arrived via POP, restored), clicks a Link to
      // /from/bar — navigationType flips to PUSH and key flips. The
      // bar entry should be treated as fresh, not restored.
      writeScrollPosition('domain:foo.com', 100);
      writeScrollPosition('domain:bar.com', 500);

      const { rerender } = renderHook(
        ({ key, navType }: { key: string; navType: NavigationType }) => {
          mockedUseNavigationType.mockReturnValue(navType);
          return useScrollRestore(key, true);
        },
        { initialProps: { key: 'domain:foo.com', navType: NavigationType.Pop } },
      );

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 100);
      });

      rerender({ key: 'domain:bar.com', navType: NavigationType.Push });

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
      });
      expect(scrollToSpy).not.toHaveBeenCalledWith(0, 500);
    });
  });

  describe('saveScrollPosition is unconditional w.r.t. navigation type', () => {
    it('writes to storage even when arriving via PUSH (so a future POP can restore)', () => {
      // The user PUSHes into /submitted/X, scrolls to 750, then
      // PUSHes elsewhere. The save fires on the way out and the
      // value must land in storage so a later browser-back POP
      // can restore.
      mockedUseNavigationType.mockReturnValue(NavigationType.Push);
      const { result } = renderHook(() =>
        useScrollRestore('user:pg', true),
      );

      act(() => {
        Object.defineProperty(window, 'scrollY', {
          value: 750,
          writable: true,
          configurable: true,
        });
        result.current.saveScrollPosition();
      });

      expect(readScrollPosition('user:pg')).toBe(750);
    });
  });

  describe('saveScrollPosition', () => {
    it('writes the current window.scrollY to storage under the supplied key', () => {
      const { result } = renderHook(() =>
        useScrollRestore('domain:github.com', true),
      );

      act(() => {
        Object.defineProperty(window, 'scrollY', {
          value: 750,
          writable: true,
          configurable: true,
        });
        result.current.saveScrollPosition();
      });

      expect(readScrollPosition('domain:github.com')).toBe(750);
    });

    it('is a no-op when key is undefined', () => {
      const { result } = renderHook(() => useScrollRestore(undefined, true));

      act(() => {
        Object.defineProperty(window, 'scrollY', {
          value: 750,
          writable: true,
          configurable: true,
        });
        result.current.saveScrollPosition();
      });

      // Nothing was written under any key.
      expect(sessionStorage.length).toBe(0);
    });
  });
});

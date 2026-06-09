import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useTheme } from './useTheme';
import { ThemeProvider } from '../context/ThemeContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe('useTheme', () => {
  it('throws error when used outside ThemeProvider', () => {
    // React logs the throw via console.error; silence to keep test output clean.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });

    expect(() => {
      renderHook(() => useTheme());
    }).toThrow('useTheme must be used within a ThemeProvider');

    spy.mockRestore();
  });

  it('exposes mode, theme, setMode and cycleMode', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.mode).toBeDefined();
    expect(result.current.theme).toBeDefined();
    expect(typeof result.current.setMode).toBe('function');
    expect(typeof result.current.cycleMode).toBe('function');
  });

  it('defaults to system mode, resolving to light when the OS is not dark', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.mode).toBe('system');
    expect(result.current.theme).toBe('light');
  });

  it('cycleMode advances system → light → dark → system', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.mode).toBe('system');

    act(() => result.current.cycleMode());
    expect(result.current.mode).toBe('light');

    act(() => result.current.cycleMode());
    expect(result.current.mode).toBe('dark');

    act(() => result.current.cycleMode());
    expect(result.current.mode).toBe('system');
  });

  it('persists the selected mode to localStorage', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => result.current.setMode('dark'));

    expect(result.current.mode).toBe('dark');
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('setting:theme')).toBe('dark');
  });

  it('rehydrates an explicit pin from localStorage on mount', () => {
    // OS is light (global matchMedia stub); the stored 'dark' pin must win so a
    // returning user keeps their choice rather than snapping back to the device.
    localStorage.setItem('setting:theme', 'dark');

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.mode).toBe('dark');
    expect(result.current.theme).toBe('dark');
  });

  it('falls back to system for an invalid stored value', () => {
    localStorage.setItem('setting:theme', 'banana');

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.mode).toBe('system');
    expect(result.current.theme).toBe('light');
  });
});

// Controllable matchMedia so we can simulate the OS flipping color schemes at
// runtime (Android light↔dark). The global jsdom mock in test/setup.ts is a
// fixed `matches: false` stub, so we override it locally and restore after.
function installMatchMediaMock(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const mql = {
    get matches() { return matches; },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn((_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    }),
    dispatchEvent: vi.fn(),
  };

  window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia;

  return {
    setDark(next: boolean) {
      matches = next;
      const event = { matches: next, media: mql.media } as MediaQueryListEvent;
      listeners.forEach(cb => cb(event));
    },
    get listenerCount() { return listeners.size; },
  };
}

describe('useTheme — system color-scheme + status bar', () => {
  const originalMatchMedia = window.matchMedia;
  let metaThemeColor: HTMLMetaElement;

  beforeEach(() => {
    // Stand-in for the <meta name="theme-color"> tag from index.html.
    metaThemeColor = document.createElement('meta');
    metaThemeColor.setAttribute('name', 'theme-color');
    document.head.appendChild(metaThemeColor);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    metaThemeColor.remove();
  });

  it('initializes from the OS scheme when in system mode', () => {
    installMatchMediaMock(true);

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.mode).toBe('system');
    expect(result.current.theme).toBe('dark');
  });

  it('follows the OS scheme live while in system mode', () => {
    const mq = installMatchMediaMock(false);

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('light');

    act(() => mq.setDark(true));
    expect(result.current.theme).toBe('dark');

    act(() => mq.setDark(false));
    expect(result.current.theme).toBe('light');
  });

  it('does NOT let an OS change override an explicit pin', () => {
    const mq = installMatchMediaMock(false);

    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => result.current.setMode('light'));
    expect(result.current.theme).toBe('light');
    // Subscription torn down once pinned.
    expect(mq.listenerCount).toBe(0);

    act(() => mq.setDark(true));
    expect(result.current.theme).toBe('light');
    expect(result.current.mode).toBe('light');
  });

  it('updates the theme-color meta tag when the mode changes (PWA status bar)', () => {
    installMatchMediaMock(false);

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(metaThemeColor.getAttribute('content')).toBe('#fffdfb');

    act(() => result.current.setMode('dark'));
    expect(metaThemeColor.getAttribute('content')).toBe('#241e1a');
  });

  it('updates the theme-color meta tag when the OS scheme changes in system mode', () => {
    const mq = installMatchMediaMock(false);

    renderHook(() => useTheme(), { wrapper });
    expect(metaThemeColor.getAttribute('content')).toBe('#fffdfb');

    act(() => mq.setDark(true));
    expect(metaThemeColor.getAttribute('content')).toBe('#241e1a');
  });
});

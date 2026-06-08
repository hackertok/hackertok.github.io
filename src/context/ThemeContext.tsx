import { useEffect, useState, type ReactNode } from 'react';
import { ThemeContext } from './themeContextDef';
import { THEME_COLORS, nextMode } from './themeConfig';
import type { Theme, ThemeMode } from '../types';

// Persisted user preference ('light' | 'dark' | 'system'). An absent or
// invalid value falls back to 'system' (follow the device).
const MODE_KEY = 'setting:theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function getSystemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(MODE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

function resolveTheme(mode: ThemeMode): Theme {
  return mode === 'system' ? getSystemTheme() : mode;
}

// Apply the resolved theme to the document: toggle the `.dark` class (drives
// the CSS tokens) AND update the theme-color meta so the PWA status bar follows.
function applyTheme(theme: Theme) {
  const root = window.document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', THEME_COLORS[theme]);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(mode));

  // Resolve + apply the theme for the current preference, and — only in 'system'
  // mode — keep following the OS scheme live (e.g. Android flipping light↔dark,
  // including scheduled/auto switching) so the app and the PWA status bar stay in
  // sync. A pin ('light'/'dark') resolves once and skips the subscription, so an
  // explicit choice is never clobbered by the system.
  useEffect(() => {
    const update = (next: Theme) => {
      setTheme(next);
      applyTheme(next);
    };

    update(resolveTheme(mode));
    if (mode !== 'system') return;

    const mq = window.matchMedia(DARK_QUERY);
    const handleChange = (event: MediaQueryListEvent) =>
      update(event.matches ? 'dark' : 'light');
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [mode]);

  // Persist only on an explicit choice. Mounting never writes, so a fresh user
  // stays "follow the device" until they opt out.
  const setMode = (next: ThemeMode) => {
    localStorage.setItem(MODE_KEY, next);
    setModeState(next);
  };

  const cycleMode = () => setMode(nextMode(mode));

  return (
    <ThemeContext.Provider value={{ mode, theme, setMode, cycleMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

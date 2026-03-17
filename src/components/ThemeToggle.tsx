import { useTheme } from '../hooks/useTheme';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="group p-2 rounded-full transition-colors"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      data-testid="theme-toggle"
    >
      {theme === 'dark' ? (
        // Sun icon — compact 8-ray, r=4 circle, short rounded rays
        <svg className="w-5 h-5 text-muted-foreground group-hover:text-accent transition-colors" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4"/>
          <rect x="11" y="2" width="2" height="3" rx="1"/>
          <rect x="11" y="19" width="2" height="3" rx="1"/>
          <rect x="2" y="11" width="3" height="2" rx="1"/>
          <rect x="19" y="11" width="3" height="2" rx="1"/>
          <rect x="11" y="2" width="2" height="3" rx="1" transform="rotate(45 12 12)"/>
          <rect x="11" y="19" width="2" height="3" rx="1" transform="rotate(45 12 12)"/>
          <rect x="11" y="2" width="2" height="3" rx="1" transform="rotate(-45 12 12)"/>
          <rect x="11" y="19" width="2" height="3" rx="1" transform="rotate(-45 12 12)"/>
        </svg>
      ) : (
        // Moon icon (filled/solid crescent)
        <svg className="w-5 h-5 text-muted-foreground group-hover:text-accent transition-colors" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  );
}

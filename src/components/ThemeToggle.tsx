import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { Button } from './ui';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const target = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${target} mode`;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={label}
      data-testid="theme-toggle"
      className="rounded-full text-muted-foreground dark:hover:bg-muted"
    >
      {theme === 'dark' ? (
        <Sun aria-hidden className="size-5" />
      ) : (
        <Moon aria-hidden className="size-5" />
      )}
    </Button>
  );
}

import { Moon, Sun, SunMoon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { nextMode } from '../context/themeConfig';
import { Button } from './ui';
import type { ThemeMode } from '../types';

const MODE_LABEL: Record<ThemeMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const MODE_ICON: Record<ThemeMode, typeof SunMoon> = {
  system: SunMoon,
  light: Sun,
  dark: Moon,
};

export function ThemeToggle() {
  const { mode, cycleMode } = useTheme();
  // The icon reflects the current preference (including System) so the active
  // mode is visible; the label announces what tapping will switch to next.
  const Icon = MODE_ICON[mode];
  const label = `Theme: ${MODE_LABEL[mode]}. Switch to ${MODE_LABEL[nextMode(mode)]}.`;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleMode}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className="rounded-full text-muted-foreground"
    >
      <Icon aria-hidden className="size-5" />
    </Button>
  );
}

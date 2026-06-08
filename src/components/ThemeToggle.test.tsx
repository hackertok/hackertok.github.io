import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as LucideReact from 'lucide-react';
import { ThemeProvider } from '../context/ThemeContext';
import { ThemeToggle } from './ThemeToggle';

// Stub only the three icons the toggle maps over so we can assert the mapping
// without coupling to lucide's internal SVG markup. Every other icon stays real
// so unrelated components keep rendering.
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof LucideReact>();
  const makeIcon = (testid: string) => {
    const Icon = (props: Record<string, unknown>) => <svg data-testid={testid} {...props} />;
    Icon.displayName = testid;
    return Icon;
  };
  return {
    ...actual,
    Sun: makeIcon('icon-sun'),
    Moon: makeIcon('icon-moon'),
    SunMoon: makeIcon('icon-sunmoon'),
  };
});

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  it('shows the System icon and the "switch to Light" label by default', () => {
    renderToggle();

    expect(screen.getByTestId('icon-sunmoon')).toBeInTheDocument();
    expect(screen.getByTestId('theme-toggle')).toHaveAttribute(
      'aria-label',
      'Theme: System. Switch to Light.',
    );
  });

  it('cycles icon + label on click: system → light → dark → system', () => {
    renderToggle();
    const button = screen.getByTestId('theme-toggle');

    fireEvent.click(button);
    expect(screen.getByTestId('icon-sun')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Theme: Light. Switch to Dark.');

    fireEvent.click(button);
    expect(screen.getByTestId('icon-moon')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Theme: Dark. Switch to System.');

    fireEvent.click(button);
    expect(screen.getByTestId('icon-sunmoon')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Theme: System. Switch to Light.');
  });
});

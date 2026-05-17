/* eslint-disable react-refresh/only-export-components */
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../context/ThemeContext';
import { NetworkStatusProvider } from '../context/NetworkStatusContext';
import { TooltipProvider } from '../components/ui';
import type { ReactElement, ReactNode } from 'react';
import type { InitialEntry } from 'react-router';

/**
 * All providers wrapper for testing — wraps with the production root
 * providers needed by virtually any rendered subtree (ThemeProvider >
 * TooltipProvider > NetworkStatusProvider) plus a MemoryRouter for routing
 * context. Intentionally OMITS ScrollContainerProvider (the fourth provider
 * in App.tsx); components that exercise scroll-container behavior wrap it
 * locally — see UserProfile.test.tsx — to avoid leaking
 * document.documentElement classes from enableSwipeMode / disableSwipeMode
 * across tests. The TooltipProvider is required because Header > ThemeToggle
 * (and any other Tooltip consumer in the rendered subtree) calls Radix's
 * `useTooltipContext` and throws "Tooltip must be used within TooltipProvider"
 * without an ancestor provider.
 */
function AllProviders({ children, initialEntries = ['/'] }: { children: ReactNode; initialEntries?: InitialEntry[] }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={250}>
        <NetworkStatusProvider>
          <MemoryRouter initialEntries={initialEntries}>
            {children}
          </MemoryRouter>
        </NetworkStatusProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

/** Custom render wrapping components with all providers. */
function customRender(ui: ReactElement, { initialEntries = ['/'], ...renderOptions }: { initialEntries?: InitialEntry[] } & Omit<RenderOptions, 'wrapper'> = {}) {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AllProviders initialEntries={initialEntries}>{children}</AllProviders>
    ),
    ...renderOptions,
  });
}

// Re-export everything from RTL
export * from '@testing-library/react';

// Override render with custom render
export { customRender as render };

// Export providers for manual wrapping if needed
export { AllProviders };

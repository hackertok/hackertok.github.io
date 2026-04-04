/* eslint-disable react-refresh/only-export-components */
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../context/ThemeContext';
import { NetworkStatusProvider } from '../context/NetworkStatusContext';
import type { ReactElement, ReactNode } from 'react';
import type { InitialEntry } from 'react-router';

/**
 * All providers wrapper for testing
 */
function AllProviders({ children, initialEntries = ['/'] }: { children: ReactNode; initialEntries?: InitialEntry[] }) {
  return (
    <ThemeProvider>
      <NetworkStatusProvider>
        <MemoryRouter initialEntries={initialEntries}>
          {children}
        </MemoryRouter>
      </NetworkStatusProvider>
    </ThemeProvider>
  );
}

/**
 * Custom render function that wraps components with necessary providers
 * @param {React.ReactElement} ui - Component to render
 * @param {Object} options - Render options
 * @param {string[]} options.initialEntries - Initial router entries
 * @param {Object} options.renderOptions - Additional render options
 */
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

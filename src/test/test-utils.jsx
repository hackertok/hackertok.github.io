/* eslint-disable react-refresh/only-export-components */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../context/ThemeContext';

/**
 * All providers wrapper for testing
 */
function AllProviders({ children, initialEntries = ['/'] }) {
  return (
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        {children}
      </MemoryRouter>
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
function customRender(ui, { initialEntries = ['/'], ...renderOptions } = {}) {
  return render(ui, {
    wrapper: ({ children }) => (
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

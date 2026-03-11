import { useContext } from 'react';
import { ThemeContext } from '../context/themeContextDef';
import type { ThemeContextValue } from '../types';

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

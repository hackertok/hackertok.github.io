import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useTheme } from './useTheme';
import { ThemeProvider } from '../context/ThemeContext';

describe('useTheme', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider>{children}</ThemeProvider>
  );

  it('throws error when used outside ThemeProvider', () => {
    // Suppress console.error for this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
    
    expect(() => {
      renderHook(() => useTheme());
    }).toThrow('useTheme must be used within a ThemeProvider');
    
    spy.mockRestore();
  });

  it('returns theme and toggleTheme from context', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    
    expect(result.current.theme).toBeDefined();
    expect(typeof result.current.toggleTheme).toBe('function');
  });

  it('theme defaults to light when no preference set', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    
    expect(result.current.theme).toBe('light');
  });

  it('toggleTheme switches between light and dark', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    
    const initialTheme = result.current.theme;
    
    act(() => {
      result.current.toggleTheme();
    });
    
    expect(result.current.theme).toBe(initialTheme === 'dark' ? 'light' : 'dark');
    
    act(() => {
      result.current.toggleTheme();
    });
    
    expect(result.current.theme).toBe(initialTheme);
  });

  it('persists theme to localStorage', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    
    act(() => {
      result.current.toggleTheme();
    });
    
    const stored = localStorage.getItem('theme');
    expect(stored).toBe(result.current.theme);
  });
});

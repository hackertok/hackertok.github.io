import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ScrollContainerProvider } from './ScrollContainerContext';
import { useScrollContainer } from '../hooks/useScrollContainer';

describe('ScrollContainerContext', () => {
  describe('useScrollContainer without provider', () => {
    it('returns default values when used outside provider', () => {
      const { result } = renderHook(() => useScrollContainer());
      
      expect(result.current.isSwipeMode).toBe(false);
      expect(typeof result.current.enableSwipeMode).toBe('function');
      expect(typeof result.current.disableSwipeMode).toBe('function');
    });

    it('default functions are no-ops', () => {
      const { result } = renderHook(() => useScrollContainer());

      expect(() => result.current.enableSwipeMode()).not.toThrow();
      expect(() => result.current.disableSwipeMode()).not.toThrow();
    });
  });

  describe('useScrollContainer with provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ScrollContainerProvider>{children}</ScrollContainerProvider>
    );

    it('starts with isSwipeMode false', () => {
      const { result } = renderHook(() => useScrollContainer(), { wrapper });
      
      expect(result.current.isSwipeMode).toBe(false);
    });

    it('enableSwipeMode sets isSwipeMode to true', () => {
      const { result } = renderHook(() => useScrollContainer(), { wrapper });
      
      act(() => {
        result.current.enableSwipeMode();
      });
      
      expect(result.current.isSwipeMode).toBe(true);
    });

    it('disableSwipeMode sets isSwipeMode to false', () => {
      const { result } = renderHook(() => useScrollContainer(), { wrapper });
      
      act(() => {
        result.current.enableSwipeMode();
      });
      
      expect(result.current.isSwipeMode).toBe(true);
      
      act(() => {
        result.current.disableSwipeMode();
      });
      
      expect(result.current.isSwipeMode).toBe(false);
    });

    it('enableSwipeMode adds swipe-mode class to body', () => {
      const { result } = renderHook(() => useScrollContainer(), { wrapper });
      
      act(() => {
        result.current.enableSwipeMode();
      });
      
      expect(document.body.classList.contains('swipe-mode')).toBe(true);
    });

    it('disableSwipeMode removes swipe-mode class from body', () => {
      const { result } = renderHook(() => useScrollContainer(), { wrapper });
      
      act(() => {
        result.current.enableSwipeMode();
      });
      
      expect(document.body.classList.contains('swipe-mode')).toBe(true);
      
      act(() => {
        result.current.disableSwipeMode();
      });
      
      expect(document.body.classList.contains('swipe-mode')).toBe(false);
    });
  });

  describe('ScrollContainerProvider', () => {
    it('renders children', () => {
      render(
        <ScrollContainerProvider>
          <div data-testid="child">Test Child</div>
        </ScrollContainerProvider>
      );
      
      expect(screen.getByTestId('child')).toBeInTheDocument();
    });
  });
});

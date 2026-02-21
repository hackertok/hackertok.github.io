import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useScrollDirection } from './useScrollDirection';

describe('useScrollDirection', () => {
  beforeEach(() => {
    // Reset scroll position
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true,
    });
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => useScrollDirection());
    
    expect(result.current.scrollDirection).toBe('up');
    expect(result.current.isAtTop).toBe(true);
  });

  it('detects scroll down', async () => {
    const { result } = renderHook(() => useScrollDirection());
    
    // Simulate scrolling down
    act(() => {
      window.scrollY = 100;
      window.dispatchEvent(new Event('scroll'));
    });
    
    // Wait for requestAnimationFrame
    await waitFor(() => {
      expect(result.current.scrollDirection).toBe('down');
    });
  });

  it('detects scroll up', async () => {
    const { result } = renderHook(() => useScrollDirection());
    
    // First scroll down
    act(() => {
      window.scrollY = 100;
      window.dispatchEvent(new Event('scroll'));
    });
    
    await waitFor(() => {
      expect(result.current.scrollDirection).toBe('down');
    });
    
    // Then scroll up
    act(() => {
      window.scrollY = 50;
      window.dispatchEvent(new Event('scroll'));
    });
    
    await waitFor(() => {
      expect(result.current.scrollDirection).toBe('up');
    });
  });

  it('sets isAtTop to false when scrolled past threshold', async () => {
    const { result } = renderHook(() => useScrollDirection());
    
    expect(result.current.isAtTop).toBe(true);
    
    act(() => {
      window.scrollY = 60; // Past the 50px threshold
      window.dispatchEvent(new Event('scroll'));
    });
    
    await waitFor(() => {
      expect(result.current.isAtTop).toBe(false);
    });
  });

  it('ignores small scroll changes below threshold', async () => {
    const { result } = renderHook(() => useScrollDirection());
    
    // Small scroll that's below the 10px threshold
    act(() => {
      window.scrollY = 5;
      window.dispatchEvent(new Event('scroll'));
    });
    
    // Direction should still be 'up'
    await waitFor(() => {
      expect(result.current.scrollDirection).toBe('up');
    });
  });

  it('cleans up scroll listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    
    const { unmount } = renderHook(() => useScrollDirection());
    
    unmount();
    
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function)
    );
    
    removeEventListenerSpy.mockRestore();
  });
});

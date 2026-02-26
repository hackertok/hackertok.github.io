import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

describe('useIsMobile', () => {
  let matchMediaMock;
  let listeners = [];

  beforeEach(() => {
    listeners = [];
    matchMediaMock = vi.fn((query) => ({
      matches: window.innerWidth <= 640,
      media: query,
      addEventListener: (event, callback) => {
        listeners.push({ event, callback });
      },
      removeEventListener: (event, callback) => {
        listeners = listeners.filter(l => l.callback !== callback);
      },
    }));
    window.matchMedia = matchMediaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns isMobile true when viewport is <= 640px', () => {
    Object.defineProperty(window, 'innerWidth', { value: 640, writable: true });
    
    const { result } = renderHook(() => useIsMobile());
    
    expect(result.current).toBe(true);
  });

  it('returns isMobile false when viewport is > 640px', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    matchMediaMock = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    window.matchMedia = matchMediaMock;
    
    const { result } = renderHook(() => useIsMobile());
    
    expect(result.current).toBe(false);
  });

  it('updates when media query changes', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    matchMediaMock = vi.fn(() => ({
      matches: false,
      addEventListener: (event, callback) => {
        listeners.push({ event, callback });
      },
      removeEventListener: vi.fn(),
    }));
    window.matchMedia = matchMediaMock;
    
    const { result } = renderHook(() => useIsMobile());
    
    expect(result.current).toBe(false);
    
    // Simulate viewport change to mobile
    act(() => {
      listeners.forEach(l => {
        if (l.event === 'change') {
          l.callback({ matches: true });
        }
      });
    });
    
    expect(result.current).toBe(true);
  });

  it('cleans up listener on unmount', () => {
    const removeEventListenerMock = vi.fn();
    matchMediaMock = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: removeEventListenerMock,
    }));
    window.matchMedia = matchMediaMock;
    
    const { unmount } = renderHook(() => useIsMobile());
    
    unmount();
    
    expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
  });
});

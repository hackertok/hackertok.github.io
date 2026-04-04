import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { NetworkStatusProvider } from '../context/NetworkStatusContext';
import { useNetworkStatus } from './useNetworkStatus';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <NetworkStatusProvider>{children}</NetworkStatusProvider>
);

describe('useNetworkStatus', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  it('returns isOnline: true by default without provider', () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
  });

  it('initializes from navigator.onLine', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const { result } = renderHook(() => useNetworkStatus(), { wrapper });
    expect(result.current.isOnline).toBe(false);
  });

  it('updates on offline and online events', () => {
    const { result } = renderHook(() => useNetworkStatus(), { wrapper });
    expect(result.current.isOnline).toBe(true);

    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(result.current.isOnline).toBe(false);

    act(() => { window.dispatchEvent(new Event('online')); });
    expect(result.current.isOnline).toBe(true);
  });

  it('removes event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useNetworkStatus(), { wrapper });

    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NetworkStatusBar } from './NetworkStatusBar';

vi.mock('../hooks/useNetworkStatus');

import { useNetworkStatus } from '../hooks/useNetworkStatus';
const mockUseNetworkStatus = vi.mocked(useNetworkStatus);

describe('NetworkStatusBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseNetworkStatus.mockReturnValue({ isOnline: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.style.removeProperty('--network-bar-height');
  });

  it('renders nothing when online (initial state)', () => {
    const { container } = render(<NetworkStatusBar />);
    expect(container.firstChild).toBeNull();
    expect(
      document.documentElement.style.getPropertyValue('--network-bar-height'),
    ).toBe('0px');
  });

  it('shows "No internet connection" when offline', () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: false });
    render(<NetworkStatusBar />);

    expect(screen.getByText('No internet connection')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('network-status-bar-offline');
    expect(
      document.documentElement.style.getPropertyValue('--network-bar-height'),
    ).toBe('32px');
  });

  it('has correct accessibility attributes', () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: false });
    render(<NetworkStatusBar />);

    const bar = screen.getByRole('status');
    expect(bar).toHaveAttribute('aria-live', 'polite');
  });

  it('shows "Back online" when reconnecting then hides after 1.5s', () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: false });
    const { rerender } = render(<NetworkStatusBar />);
    expect(screen.getByText('No internet connection')).toBeInTheDocument();

    // Go back online
    mockUseNetworkStatus.mockReturnValue({ isOnline: true });
    rerender(<NetworkStatusBar />);

    expect(screen.getByText('Back online')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('network-status-bar-online');
    expect(
      document.documentElement.style.getPropertyValue('--network-bar-height'),
    ).toBe('32px');

    // After 1.5s, bar starts sliding out
    act(() => { vi.advanceTimersByTime(1500); });

    const bar = screen.getByRole('status');
    expect(bar).toHaveClass('network-status-bar-exit');
    expect(
      document.documentElement.style.getPropertyValue('--network-bar-height'),
    ).toBe('32px');

    // After exit animation duration (300ms fallback timer), bar is removed
    act(() => { vi.advanceTimersByTime(300); });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      document.documentElement.style.getPropertyValue('--network-bar-height'),
    ).toBe('0px');
  });

  it('does not show "Back online" if never went offline', () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: true });
    const { container } = render(<NetworkStatusBar />);
    expect(container.firstChild).toBeNull();
  });

  it('resets --network-bar-height on unmount', () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: false });
    const { unmount } = render(<NetworkStatusBar />);

    expect(
      document.documentElement.style.getPropertyValue('--network-bar-height'),
    ).toBe('32px');

    unmount();

    expect(
      document.documentElement.style.getPropertyValue('--network-bar-height'),
    ).toBe('0px');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoRetry } from './useAutoRetry';

describe('useAutoRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns idle state when there is no error', () => {
    const retryFn = vi.fn();
    const { result } = renderHook(() =>
      useAutoRetry({ error: null, retryFn, isOnline: true }),
    );
    expect(result.current.isRetrying).toBe(false);
    expect(result.current.giveUp).toBe(false);
  });

  it('schedules retries with exponential backoff (2s, 4s, 8s)', async () => {
    const retryFn = vi.fn();
    const { result } = renderHook(() =>
      useAutoRetry({ error: 'fail', retryFn, isOnline: true }),
    );
    expect(result.current.isRetrying).toBe(true);
    expect(retryFn).not.toHaveBeenCalled();

    // 1st retry at 2s
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1);

    // 2nd retry at 4s
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(retryFn).toHaveBeenCalledTimes(2);

    // 3rd retry at 8s
    await act(async () => { vi.advanceTimersByTime(8000); });
    expect(retryFn).toHaveBeenCalledTimes(3);

    // After 3 attempts: given up
    expect(result.current.giveUp).toBe(true);
    expect(result.current.isRetrying).toBe(false);
  });

  it('does not retry or increment attempts while offline', async () => {
    const retryFn = vi.fn();
    const { result } = renderHook(() =>
      useAutoRetry({ error: 'fail', retryFn, isOnline: false }),
    );

    expect(result.current.isRetrying).toBe(true);

    // Advance well past all backoff delays
    await act(async () => { vi.advanceTimersByTime(30000); });

    expect(retryFn).not.toHaveBeenCalled();
    expect(result.current.giveUp).toBe(false);
    expect(result.current.isRetrying).toBe(true);
  });

  it('retries after 500ms when going from offline to online', async () => {
    const retryFn = vi.fn();
    const { rerender } = renderHook(
      (props) => useAutoRetry(props),
      { initialProps: { error: 'fail' as string | null, retryFn, isOnline: false } },
    );

    // Go online
    rerender({ error: 'fail', retryFn, isOnline: true });

    // Not yet — 500ms reconnect delay
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(retryFn).not.toHaveBeenCalled();

    // Now fires
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(retryFn).toHaveBeenCalledTimes(1);
  });

  it('resets attempts when error clears and no retry is in-flight', async () => {
    const retryFn = vi.fn();
    const { result, rerender } = renderHook(
      (props) => useAutoRetry(props),
      { initialProps: { error: 'fail' as string | null, retryFn, isOnline: true } },
    );

    // Advance partway — timer hasn't fired, retryInFlightRef is false
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(retryFn).not.toHaveBeenCalled();

    // Error clears (e.g. user navigated away) — resets attempts to 0
    rerender({ error: null, retryFn, isOnline: true });
    expect(result.current.isRetrying).toBe(false);

    // New error should start from attempt 0 (2s delay, not 4s)
    rerender({ error: 'new fail', retryFn, isOnline: true });

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1);
  });

  it('preserves attempts when error clears during in-flight retry', async () => {
    const retryFn = vi.fn();
    const { rerender } = renderHook(
      (props) => useAutoRetry(props),
      { initialProps: { error: 'fail' as string | null, retryFn, isOnline: true } },
    );

    // 1st retry fires — retryInFlightRef becomes true
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1);

    // Error clears (retry's fetch clears error optimistically) — attempts preserved
    rerender({ error: null, retryFn, isOnline: true });

    // Error returns (retry's fetch failed) — should use 2nd backoff (4s)
    rerender({ error: 'still failing', retryFn, isOnline: true });
    retryFn.mockClear();

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).not.toHaveBeenCalled(); // not at 2s

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1); // at 4s
  });

  it('resetRetry clears state and restarts retries', async () => {
    const retryFn = vi.fn();
    const { result } = renderHook(() =>
      useAutoRetry({ error: 'fail', retryFn, isOnline: true }),
    );

    // Exhaust all retries
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => { vi.advanceTimersByTime(4000); });
    await act(async () => { vi.advanceTimersByTime(8000); });
    expect(result.current.giveUp).toBe(true);
    expect(result.current.isRetrying).toBe(false);

    // Reset — retries restart from attempt 0
    act(() => { result.current.resetRetry(); });
    expect(result.current.giveUp).toBe(false);
    expect(result.current.isRetrying).toBe(true);

    // Confirm: next retry fires at 2s (attempt 0 backoff)
    retryFn.mockClear();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1);
  });

  it('does not retry when enabled is false', async () => {
    const retryFn = vi.fn();
    const { result } = renderHook(() =>
      useAutoRetry({ error: 'fail', retryFn, isOnline: true, enabled: false }),
    );

    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(retryFn).not.toHaveBeenCalled();
    expect(result.current.isRetrying).toBe(false);
    expect(result.current.giveUp).toBe(false);
  });

  it('respects custom maxAttempts', async () => {
    const retryFn = vi.fn();
    const { result } = renderHook(() =>
      useAutoRetry({ error: 'fail', retryFn, isOnline: true, maxAttempts: 1 }),
    );

    // Only 1 attempt before giving up
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1);
    expect(result.current.giveUp).toBe(true);
  });

  it('cleans up timer on unmount', async () => {
    const retryFn = vi.fn();
    const { unmount } = renderHook(() =>
      useAutoRetry({ error: 'fail', retryFn, isOnline: true }),
    );

    unmount();
    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(retryFn).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoRetry } from './useAutoRetry';

type UseAutoRetryProps = Parameters<typeof useAutoRetry>[0];

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

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(retryFn).toHaveBeenCalledTimes(2);

    await act(async () => { vi.advanceTimersByTime(8000); });
    expect(retryFn).toHaveBeenCalledTimes(3);

    expect(result.current.giveUp).toBe(true);
    expect(result.current.isRetrying).toBe(false);
  });

  it('does not retry or increment attempts while offline', async () => {
    const retryFn = vi.fn();
    const { result } = renderHook(() =>
      useAutoRetry({ error: 'fail', retryFn, isOnline: false }),
    );

    expect(result.current.isRetrying).toBe(true);

    await act(async () => { vi.advanceTimersByTime(30000); });

    expect(retryFn).not.toHaveBeenCalled();
    expect(result.current.giveUp).toBe(false);
    expect(result.current.isRetrying).toBe(true);
  });

  it('retries after 500ms when going from offline to online', async () => {
    const retryFn = vi.fn();
    const initialProps: UseAutoRetryProps = { error: 'fail', retryFn, isOnline: false };
    const { rerender } = renderHook(
      (props: UseAutoRetryProps) => useAutoRetry(props),
      { initialProps },
    );

    rerender({ error: 'fail', retryFn, isOnline: true });

    // 500ms reconnect delay before firing
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(retryFn).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(100); });
    expect(retryFn).toHaveBeenCalledTimes(1);
  });

  it('resets attempts when error clears and no retry is in-flight', async () => {
    const retryFn = vi.fn();
    const initialProps: UseAutoRetryProps = { error: 'fail', retryFn, isOnline: true };
    const { result, rerender } = renderHook(
      (props: UseAutoRetryProps) => useAutoRetry(props),
      { initialProps },
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

  it('preserves attempts when error clears during in-flight Promise retry', async () => {
    // Only Promise-returning retryFn can track in-flight state.
    // While the Promise is pending, an optimistic error-clear should NOT
    // reset attempts — the fetch may still fail.
    let resolveRetry!: () => void;
    const retryFn = vi.fn(() => new Promise<void>(r => { resolveRetry = r; }));

    const initialProps: UseAutoRetryProps = { error: 'fail', retryFn, isOnline: true };
    const { rerender } = renderHook(
      (props: UseAutoRetryProps) => useAutoRetry(props),
      { initialProps },
    );

    // 1st retry fires — retryInFlightRef becomes true (Promise pending)
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1);

    // Error clears (retry's fetch clears error optimistically) — attempts preserved
    rerender({ error: null, retryFn, isOnline: true });

    // Error returns (retry's fetch failed) — should use 2nd backoff (4s)
    rerender({ error: 'still failing', retryFn, isOnline: true });
    // Reject the in-flight Promise to settle it
    await act(async () => { resolveRetry(); });
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

    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => { vi.advanceTimersByTime(4000); });
    await act(async () => { vi.advanceTimersByTime(8000); });
    expect(result.current.giveUp).toBe(true);
    expect(result.current.isRetrying).toBe(false);

    act(() => { result.current.resetRetry(); });
    expect(result.current.giveUp).toBe(false);
    expect(result.current.isRetrying).toBe(true);

    // After reset, next retry must fire at 2s (attempt 0 backoff), not 16s.
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

  it('counts reconnect retries toward maxAttempts', async () => {
    const retryFn = vi.fn();
    type Props = Parameters<typeof useAutoRetry>[0];

    const initialProps: Props = { error: 'fail', retryFn, isOnline: true, maxAttempts: 2 };
    const { result, rerender } = renderHook(
      (props: Props) => useAutoRetry(props),
      { initialProps },
    );

    // Go offline before the first backoff timer fires
    rerender({ error: 'fail', retryFn, isOnline: false, maxAttempts: 2 });

    // Come back online → reconnect retry (counts as attempt 1)
    rerender({ error: 'fail', retryFn, isOnline: true, maxAttempts: 2 });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(retryFn).toHaveBeenCalledTimes(1);

    // Flicker again → reconnect retry (counts as attempt 2 → giveUp)
    rerender({ error: 'fail', retryFn, isOnline: false, maxAttempts: 2 });
    rerender({ error: 'fail', retryFn, isOnline: true, maxAttempts: 2 });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(retryFn).toHaveBeenCalledTimes(2);

    // A third flicker must NOT produce another retry — maxAttempts reached
    rerender({ error: 'fail', retryFn, isOnline: false, maxAttempts: 2 });
    rerender({ error: 'fail', retryFn, isOnline: true, maxAttempts: 2 });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(retryFn).toHaveBeenCalledTimes(2); // still 2 — no extra retry
    expect(result.current.giveUp).toBe(true);
  });

  it('resets attempts after a successful Promise-returning retry', async () => {
    let resolveRetry!: () => void;
    const retryFn = vi.fn(() => new Promise<void>(r => { resolveRetry = r; }));

    const initialProps: UseAutoRetryProps = { error: 'fail', retryFn, isOnline: true };
    const { result, rerender } = renderHook(
      (props: UseAutoRetryProps) => useAutoRetry(props),
      { initialProps },
    );

    // 1st retry fires — retryFn returns a Promise
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1);

    // Error clears (optimistic clear by the retried fetch)
    rerender({ error: null, retryFn, isOnline: true });

    // Retry Promise resolves (fetch succeeded — error stays null)
    await act(async () => { resolveRetry(); });

    // New error should start from attempt 0 (2s delay, not 4s)
    rerender({ error: 'new fail', retryFn, isOnline: true });
    expect(result.current.giveUp).toBe(false);
    retryFn.mockClear();

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1); // fires at 2s, proving attempts reset
  });

  it('does not accumulate attempts across separate successful retry cycles', async () => {
    let resolveRetry!: () => void;
    const retryFn = vi.fn(() => new Promise<void>(r => { resolveRetry = r; }));

    const initialProps: UseAutoRetryProps = { error: 'fail', retryFn, isOnline: true };
    const { result, rerender } = renderHook(
      (props: UseAutoRetryProps) => useAutoRetry(props),
      { initialProps },
    );

    for (let cycle = 1; cycle <= 3; cycle++) {
      retryFn.mockClear();
      // Wait for retry to fire (always 2s if attempts reset properly)
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(retryFn).toHaveBeenCalledTimes(1);

      // Retry succeeds: error clears, Promise resolves
      rerender({ error: null, retryFn, isOnline: true });
      await act(async () => { resolveRetry(); });

      if (cycle < 3) {
        // Trigger next error cycle
        rerender({ error: `fail ${cycle + 1}`, retryFn, isOnline: true });
      }
    }

    // After 3 separate SUCCESSFUL retries, the 4th error must NOT give up
    rerender({ error: 'fail 4', retryFn, isOnline: true });
    expect(result.current.giveUp).toBe(false);
    expect(result.current.isRetrying).toBe(true);
  });

  it('preserves attempts when isOnline toggles during in-flight Promise retry', async () => {
    let rejectRetry!: (err: Error) => void;
    const retryFn = vi.fn(() => new Promise<void>((_res, rej) => {
      rejectRetry = rej;
    }));

    const initialProps: UseAutoRetryProps = { error: 'fail', retryFn, isOnline: true };
    const { rerender } = renderHook(
      (props: UseAutoRetryProps) => useAutoRetry(props),
      { initialProps },
    );

    // 1st retry fires at 2s — Promise is pending
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1);

    // retryFn clears error optimistically (simulating what loadMore does)
    rerender({ error: null, retryFn, isOnline: true });

    // Network toggles while Promise is still pending
    rerender({ error: null, retryFn, isOnline: false });
    rerender({ error: null, retryFn, isOnline: true });

    // Promise rejects (fetch failed)
    await act(async () => { rejectRetry(new Error('network')); });

    // Error returns — should use 2nd backoff (4s), not 1st (2s)
    rerender({ error: 'still failing', retryFn, isOnline: true });
    retryFn.mockClear();

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).not.toHaveBeenCalled(); // must not fire at 2s

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(retryFn).toHaveBeenCalledTimes(1); // fires at 4s
  });
});

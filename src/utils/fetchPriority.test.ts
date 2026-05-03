import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerPriorityFetch,
  unregisterPriorityFetch,
  isPriorityFetchActive,
  onPriorityFetchChange,
  waitForPriorityFetch,
  _resetForTesting,
} from './fetchPriority';

describe('fetchPriority', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  describe('registerPriorityFetch / unregisterPriorityFetch', () => {
    it('tracks single priority fetch', () => {
      expect(isPriorityFetchActive()).toBe(false);
      
      registerPriorityFetch();
      expect(isPriorityFetchActive()).toBe(true);
      
      unregisterPriorityFetch();
      expect(isPriorityFetchActive()).toBe(false);
    });

    it('handles multiple concurrent priority fetches (ref counting)', () => {
      registerPriorityFetch();
      registerPriorityFetch();
      expect(isPriorityFetchActive()).toBe(true);

      unregisterPriorityFetch();
      expect(isPriorityFetchActive()).toBe(true);

      unregisterPriorityFetch();
      expect(isPriorityFetchActive()).toBe(false);
    });

    it('never goes negative on count', () => {
      unregisterPriorityFetch();
      unregisterPriorityFetch();
      expect(isPriorityFetchActive()).toBe(false);

      // Verifies the negative-count guard didn't poison subsequent registers.
      registerPriorityFetch();
      expect(isPriorityFetchActive()).toBe(true);
    });
  });

  describe('onPriorityFetchChange', () => {
    it('immediately calls listener with current state', () => {
      const listener = vi.fn();
      
      onPriorityFetchChange(listener);
      expect(listener).toHaveBeenCalledWith(false);
    });

    it('notifies on register', () => {
      const listener = vi.fn();
      onPriorityFetchChange(listener);
      listener.mockClear();
      
      registerPriorityFetch();
      expect(listener).toHaveBeenCalledWith(true);
    });

    it('notifies on unregister', () => {
      registerPriorityFetch();
      
      const listener = vi.fn();
      onPriorityFetchChange(listener);
      listener.mockClear();
      
      unregisterPriorityFetch();
      expect(listener).toHaveBeenCalledWith(false);
    });

    it('returns unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = onPriorityFetchChange(listener);
      listener.mockClear();
      
      unsubscribe();
      registerPriorityFetch();
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('waitForPriorityFetch', () => {
    it('resolves immediately when no priority fetch active', async () => {
      await expect(waitForPriorityFetch()).resolves.toBeUndefined();
    });

    it('waits until priority fetch completes', async () => {
      registerPriorityFetch();

      let resolved = false;
      const promise = waitForPriorityFetch().then(() => {
        resolved = true;
      });

      await Promise.resolve();
      expect(resolved).toBe(false);

      unregisterPriorityFetch();
      await promise;
      expect(resolved).toBe(true);
    });

    it('rejects if already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      
      await expect(waitForPriorityFetch(controller.signal))
        .rejects.toThrow('Aborted');
    });

    it('rejects if aborted while waiting', async () => {
      registerPriorityFetch();
      
      const controller = new AbortController();
      const promise = waitForPriorityFetch(controller.signal);
      
      controller.abort();
      
      await expect(promise).rejects.toThrow('Aborted');
    });

    it('handles multiple waiters', async () => {
      registerPriorityFetch();
      
      const results: number[] = [];
      const p1 = waitForPriorityFetch().then(() => results.push(1));
      const p2 = waitForPriorityFetch().then(() => results.push(2));
      
      unregisterPriorityFetch();
      await Promise.all([p1, p2]);
      
      expect(results).toHaveLength(2);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readScrollPosition,
  writeScrollPosition,
  clearScrollPosition,
} from './scrollRestore';

describe('scrollRestore storage helpers', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('write + read round-trip', () => {
    it('returns the value previously written under the same key', () => {
      writeScrollPosition('domain:github.com', 1234);
      expect(readScrollPosition('domain:github.com')).toBe(1234);
    });

    it('treats 0 as a valid restored value (user was at the top)', () => {
      writeScrollPosition('user:pg', 0);
      expect(readScrollPosition('user:pg')).toBe(0);
    });

    it('keeps keys independent (different domains do not share state)', () => {
      writeScrollPosition('domain:foo.com', 100);
      writeScrollPosition('domain:bar.com', 200);
      expect(readScrollPosition('domain:foo.com')).toBe(100);
      expect(readScrollPosition('domain:bar.com')).toBe(200);
    });
  });

  describe('readScrollPosition fresh-nav signal', () => {
    it('returns null when nothing has been stored for the key', () => {
      expect(readScrollPosition('domain:never-saved.com')).toBeNull();
    });

    it('returns null and removes the entry when older than 30 minutes', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
        writeScrollPosition('domain:github.com', 500);
        // 31 minutes later — past the 30-minute TTL.
        vi.setSystemTime(new Date('2026-01-01T12:31:00Z'));
        expect(readScrollPosition('domain:github.com')).toBeNull();
        // Side-effect: expired entry is purged so a future call is also null.
        expect(sessionStorage.getItem('scroll:domain:github.com')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('survives a read that lands within the TTL window', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
        writeScrollPosition('domain:github.com', 500);
        vi.setSystemTime(new Date('2026-01-01T12:29:59Z'));
        expect(readScrollPosition('domain:github.com')).toBe(500);
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns null when the stored payload is malformed JSON', () => {
      sessionStorage.setItem('scroll:domain:github.com', '{not valid json');
      expect(readScrollPosition('domain:github.com')).toBeNull();
    });

    it('returns null when the stored payload is missing required fields', () => {
      sessionStorage.setItem(
        'scroll:domain:github.com',
        JSON.stringify({ scrollY: 100 }), // missing timestamp
      );
      expect(readScrollPosition('domain:github.com')).toBeNull();
    });
  });

  describe('clearScrollPosition', () => {
    it('removes the entry so the next read signals fresh nav', () => {
      writeScrollPosition('domain:github.com', 500);
      clearScrollPosition('domain:github.com');
      expect(readScrollPosition('domain:github.com')).toBeNull();
    });
  });

  describe('error tolerance', () => {
    it('does not throw when sessionStorage.setItem throws (e.g. quota)', () => {
      const setItemSpy = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('QuotaExceededError');
        });
      try {
        expect(() => writeScrollPosition('domain:github.com', 1)).not.toThrow();
      } finally {
        setItemSpy.mockRestore();
      }
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });
});

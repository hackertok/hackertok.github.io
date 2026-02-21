import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTimeAgo, getHostname } from './hn';

describe('hn API utilities', () => {
  describe('formatTimeAgo', () => {
    beforeEach(() => {
      // Mock Date.now for consistent tests
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns empty string for null/undefined', () => {
      expect(formatTimeAgo(null)).toBe('');
      expect(formatTimeAgo(undefined)).toBe('');
    });

    it('returns empty string for invalid timestamp', () => {
      expect(formatTimeAgo(NaN)).toBe('');
      expect(formatTimeAgo('invalid')).toBe('');
    });

    it('returns "just now" for very recent times', () => {
      const now = Date.now();
      expect(formatTimeAgo(now)).toBe('just now');
      expect(formatTimeAgo(now - 30 * 1000)).toBe('just now'); // 30 seconds ago
    });

    it('returns "just now" for future dates', () => {
      const future = Date.now() + 60 * 1000; // 1 minute in future
      expect(formatTimeAgo(future)).toBe('just now');
    });

    it('formats minutes correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 60 * 1000)).toBe('1 minute ago');
      expect(formatTimeAgo(now - 5 * 60 * 1000)).toBe('5 minutes ago');
      expect(formatTimeAgo(now - 30 * 60 * 1000)).toBe('30 minutes ago');
    });

    it('formats hours correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 60 * 60 * 1000)).toBe('1 hour ago');
      expect(formatTimeAgo(now - 3 * 60 * 60 * 1000)).toBe('3 hours ago');
      expect(formatTimeAgo(now - 23 * 60 * 60 * 1000)).toBe('23 hours ago');
    });

    it('formats days correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 24 * 60 * 60 * 1000)).toBe('1 day ago');
      expect(formatTimeAgo(now - 7 * 24 * 60 * 60 * 1000)).toBe('7 days ago');
      expect(formatTimeAgo(now - 29 * 24 * 60 * 60 * 1000)).toBe('29 days ago');
    });

    it('formats months correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 30 * 24 * 60 * 60 * 1000)).toBe('1 month ago');
      expect(formatTimeAgo(now - 90 * 24 * 60 * 60 * 1000)).toBe('3 months ago');
    });

    it('formats years correctly', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 365 * 24 * 60 * 60 * 1000)).toBe('1 year ago');
      expect(formatTimeAgo(now - 2 * 365 * 24 * 60 * 60 * 1000)).toBe('2 years ago');
    });

    it('uses singular form for 1 unit', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 1 * 60 * 1000)).toBe('1 minute ago');
      expect(formatTimeAgo(now - 1 * 60 * 60 * 1000)).toBe('1 hour ago');
      expect(formatTimeAgo(now - 1 * 24 * 60 * 60 * 1000)).toBe('1 day ago');
    });

    it('uses plural form for > 1 unit', () => {
      const now = Date.now();
      expect(formatTimeAgo(now - 2 * 60 * 1000)).toBe('2 minutes ago');
      expect(formatTimeAgo(now - 2 * 60 * 60 * 1000)).toBe('2 hours ago');
      expect(formatTimeAgo(now - 2 * 24 * 60 * 60 * 1000)).toBe('2 days ago');
    });
  });

  describe('getHostname', () => {
    it('returns null for null/undefined/empty input', () => {
      expect(getHostname(null)).toBeNull();
      expect(getHostname(undefined)).toBeNull();
      expect(getHostname('')).toBeNull();
    });

    it('returns empty or null for non-HTTP URLs and malformed strings', () => {
      expect(getHostname('not-a-url')).toBeNull(); // Throws in URL constructor
      expect(getHostname('javascript:alert(1)')).toBe(''); // Parses but has empty hostname
    });

    it('extracts hostname from simple URL', () => {
      expect(getHostname('https://example.com')).toBe('example.com');
      expect(getHostname('https://example.com/page')).toBe('example.com');
    });

    it('removes www prefix', () => {
      expect(getHostname('https://www.example.com')).toBe('example.com');
      expect(getHostname('https://www.google.com/search')).toBe('google.com');
    });

    it('handles various protocols', () => {
      expect(getHostname('http://example.com')).toBe('example.com');
      expect(getHostname('https://example.com')).toBe('example.com');
    });

    it('includes first path segment for GitHub URLs', () => {
      expect(getHostname('https://github.com/facebook/react')).toBe('github.com/facebook');
      expect(getHostname('https://github.com/vercel/next.js')).toBe('github.com/vercel');
    });

    it('includes first path segment for GitLab URLs', () => {
      expect(getHostname('https://gitlab.com/gitlab-org/gitlab')).toBe('gitlab.com/gitlab-org');
    });

    it('includes first path segment for Bitbucket URLs', () => {
      expect(getHostname('https://bitbucket.org/atlassian/python-bitbucket')).toBe('bitbucket.org/atlassian');
    });

    it('includes first path segment for Codeberg URLs', () => {
      expect(getHostname('https://codeberg.org/Codeberg/forgejo')).toBe('codeberg.org/Codeberg');
    });

    it('does not include path for other domains', () => {
      expect(getHostname('https://news.ycombinator.com/item?id=123')).toBe('news.ycombinator.com');
      expect(getHostname('https://medium.com/@user/article')).toBe('medium.com');
    });

    it('handles URLs without path segments', () => {
      expect(getHostname('https://github.com')).toBe('github.com');
      expect(getHostname('https://github.com/')).toBe('github.com');
    });
  });
});

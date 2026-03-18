import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  describe('basic functionality', () => {
    it('returns empty string for null/undefined input', () => {
      expect(sanitizeHtml(null)).toBe('');
      expect(sanitizeHtml(undefined)).toBe('');
      expect(sanitizeHtml('')).toBe('');
    });

    it('returns empty string for non-string input', () => {
      expect(sanitizeHtml(123 as unknown as string)).toBe('');
      expect(sanitizeHtml({} as unknown as string)).toBe('');
      expect(sanitizeHtml([] as unknown as string)).toBe('');
    });

    it('preserves plain text', () => {
      expect(sanitizeHtml('Hello World')).toBe('Hello World');
    });

    it('preserves allowed HTML tags', () => {
      expect(sanitizeHtml('<p>paragraph</p>')).toContain('<p>');
      expect(sanitizeHtml('<strong>bold</strong>')).toContain('<strong>');
      expect(sanitizeHtml('<em>italic</em>')).toContain('<em>');
      expect(sanitizeHtml('<code>code</code>')).toContain('<code>');
      expect(sanitizeHtml('<pre>pre</pre>')).toContain('<pre>');
    });
  });

  describe('XSS prevention', () => {
    it('removes script tags completely', () => {
      const result = sanitizeHtml('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('alert');
    });

    it('removes onclick and other event handlers', () => {
      const result = sanitizeHtml('<div onclick="alert(1)">click me</div>');
      expect(result).not.toContain('onclick');
    });

    it('removes onerror event handler', () => {
      const result = sanitizeHtml('<img src="x" onerror="alert(1)">');
      expect(result).not.toContain('onerror');
    });

    it('removes javascript: URLs in href', () => {
      const result = sanitizeHtml('<a href="javascript:alert(1)">link</a>');
      expect(result).not.toContain('javascript:');
    });

    it('removes data: URLs in href (XSS vector)', () => {
      const result = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">link</a>');
      expect(result).not.toContain('data:');
      expect(result).toContain('>link</a>'); // Link text preserved
    });

    it('removes iframe tags', () => {
      const result = sanitizeHtml('<iframe src="evil.com"></iframe>');
      expect(result).not.toContain('<iframe');
    });

    it('removes style tags', () => {
      const result = sanitizeHtml('<style>body{display:none}</style>');
      expect(result).not.toContain('<style>');
    });

    it('removes form and input elements', () => {
      const result = sanitizeHtml('<form><input type="text"></form>');
      expect(result).not.toContain('<form>');
      expect(result).not.toContain('<input');
    });
  });

  describe('link handling', () => {
    it('preserves safe http links', () => {
      const result = sanitizeHtml('<a href="http://example.com">link</a>');
      expect(result).toContain('href="http://example.com"');
    });

    it('preserves safe https links', () => {
      const result = sanitizeHtml('<a href="https://example.com">link</a>');
      expect(result).toContain('href="https://example.com"');
    });

    it('preserves mailto links', () => {
      const result = sanitizeHtml('<a href="mailto:test@example.com">email</a>');
      expect(result).toContain('mailto:');
    });

    it('opens links in the same tab (no target="_blank")', () => {
      const result = sanitizeHtml('<a href="https://example.com">link</a>');
      expect(result).not.toContain('target=');
    });

    it('adds rel="noreferrer" to links', () => {
      const result = sanitizeHtml('<a href="https://example.com">link</a>');
      expect(result).toContain('rel="noreferrer"');
    });

    it('overrides existing rel and strips target from input HTML', () => {
      const result = sanitizeHtml('<a href="https://example.com" target="_blank" rel="noopener">link</a>');
      expect(result).not.toContain('target=');
      expect(result).toContain('rel="noreferrer"');
      expect(result).not.toContain('noopener');
    });

    it('preserves relative URLs', () => {
      const result = sanitizeHtml('<a href="/about">about</a>');
      expect(result).toContain('href="/about"');
    });

    it('preserves hash URLs', () => {
      const result = sanitizeHtml('<a href="#section">section</a>');
      expect(result).toContain('href="#section"');
    });
  });

  describe('attribute filtering', () => {
    it('preserves allowed attributes', () => {
      const result = sanitizeHtml('<a href="https://example.com" class="link">text</a>');
      expect(result).toContain('href=');
      expect(result).toContain('class="link"');
    });

    it('removes disallowed attributes', () => {
      const result = sanitizeHtml('<div data-custom="value" style="color:red">text</div>');
      expect(result).not.toContain('data-custom');
      expect(result).not.toContain('style=');
    });
  });

  describe('nested content', () => {
    it('handles nested allowed tags', () => {
      const result = sanitizeHtml('<p><strong>bold <em>and italic</em></strong></p>');
      expect(result).toContain('<p>');
      expect(result).toContain('<strong>');
      expect(result).toContain('<em>');
    });

    it('removes script inside allowed tag while keeping text', () => {
      const result = sanitizeHtml('<p>before <script>evil()</script> after</p>');
      expect(result).toContain('before');
      expect(result).toContain('after');
      expect(result).not.toContain('<script>');
    });
  });
});

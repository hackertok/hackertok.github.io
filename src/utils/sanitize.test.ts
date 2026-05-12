import { describe, it, expect } from 'vitest';
import DOMPurify from 'dompurify';
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

  describe('<pre> dedent', () => {
    it('strips uniform leading indent from a <pre><code> block', () => {
      const html = '<pre><code>    line1\n    line2\n    line3</code></pre>';
      const result = sanitizeHtml(html);
      expect(result).toContain('<pre><code>line1\nline2\nline3</code></pre>');
    });

    it('preserves relative indent (continuation lines stay indented under their parent)', () => {
      const html = '<pre><code>    if (x)\n        foo();\n    bar();</code></pre>';
      const result = sanitizeHtml(html);
      expect(result).toContain('<pre><code>if (x)\n    foo();\nbar();</code></pre>');
    });

    it('ignores blank lines when computing the common indent', () => {
      const html = '<pre><code>    line1\n\n    line2</code></pre>';
      const result = sanitizeHtml(html);
      expect(result).toContain('<pre><code>line1\n\nline2</code></pre>');
    });

    it('leaves a block with no leading indent unchanged', () => {
      const html = '<pre><code>line1\nline2</code></pre>';
      const result = sanitizeHtml(html);
      expect(result).toContain('<pre><code>line1\nline2</code></pre>');
    });

    it('preserves the inner <code> wrapper so `.comment-content pre code` styles still apply', () => {
      const html = '<pre><code>    foo</code></pre>';
      const result = sanitizeHtml(html);
      expect(result).toContain('<code>');
      expect(result).toContain('</code>');
    });

    it('handles bare <pre> (no <code> child) by dedenting the <pre> directly', () => {
      const html = '<pre>    line1\n    line2</pre>';
      const result = sanitizeHtml(html);
      expect(result).toContain('<pre>line1\nline2</pre>');
    });

    it('preserves an auto-linkified URL inside a <pre> at the cost of skipping dedent', () => {
      // HN linkifies URLs everywhere except submission text fields,
      // including inside <pre> (per https://news.ycombinator.com/formatdoc).
      // We'd rather keep the <a> clickable than wipe it via textContent,
      // so this case keeps its leading indent.
      const html =
        '<pre><code>    // see <a href="https://example.com">https://example.com</a> for details</code></pre>';
      const result = sanitizeHtml(html);
      expect(result).toContain('<a');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('    // see');
    });

    it('dedents the real-world HN code-block shape (4-space source indent)', () => {
      // Mirrors the Algolia API's actual output for an HN comment that
      // uses the 4-space-indent code-block convention. The `&&` operator
      // round-trips through innerHTML escaping as `&amp;&amp;` — that's
      // browser-side HTML serialisation, not a sanitiser change.
      const html =
        '<pre><code>    // Step 9. Null move search\n' +
        '    if (cutNode\n' +
        '        && pos.non_pawn_material(us))\n' +
        '    {</code></pre>';
      const result = sanitizeHtml(html);
      expect(result).toContain(
        '<pre><code>// Step 9. Null move search\n' +
          'if (cutNode\n' +
          '    &amp;&amp; pos.non_pawn_material(us))\n' +
          '{</code></pre>',
      );
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
      expect(result).toContain('>link</a>');
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

  describe('auto-linking bare URLs', () => {
    it('wraps a bare https URL in an <a> tag', () => {
      const result = sanitizeHtml('<p>https://example.com</p>');
      expect(result).toContain('<a');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('rel="noreferrer"');
    });

    it('wraps a bare http URL in an <a> tag', () => {
      const result = sanitizeHtml('<p>http://example.com</p>');
      expect(result).toContain('<a');
      expect(result).toContain('href="http://example.com"');
    });

    it('auto-links multiple URLs in separate paragraphs', () => {
      const html = '<p>https://a.com</p><p>https://b.com</p>';
      const result = sanitizeHtml(html);
      expect(result).toContain('href="https://a.com"');
      expect(result).toContain('href="https://b.com"');
    });

    it('auto-links a URL surrounded by text', () => {
      const result = sanitizeHtml('Visit https://example.com for info');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('Visit ');
      expect(result).toContain(' for info');
    });

    it('does not double-link an already-linked URL', () => {
      const html = '<a href="https://example.com">https://example.com</a>';
      const result = sanitizeHtml(html);
      const linkCount = (result.match(/<a /g) ?? []).length;
      expect(linkCount).toBe(1);
    });

    it('does not auto-link URLs inside <code>', () => {
      const result = sanitizeHtml('<code>https://example.com</code>');
      expect(result).not.toContain('<a');
    });

    it('does not auto-link URLs inside <pre>', () => {
      const result = sanitizeHtml('<pre>https://example.com</pre>');
      expect(result).not.toContain('<a');
    });

    it('preserves query strings and fragments in auto-linked URLs', () => {
      const url = 'https://example.com/path?key=val&amp;other=2#frag';
      const result = sanitizeHtml(`<p>${url}</p>`);
      expect(result).toContain('href="https://example.com/path?key=val&amp;other=2#frag"');
    });

    it('rewrites auto-linked HN item URLs to internal routes', () => {
      const result = sanitizeHtml('<p>https://news.ycombinator.com/item?id=12345</p>');
      expect(result).toContain('href="#/item/12345"');
    });

    it('wraps a bare email address in a mailto: link', () => {
      const result = sanitizeHtml('Contact me at user@example.com for info');
      expect(result).toContain('href="mailto:user@example.com"');
      expect(result).toContain('>user@example.com<');
    });

    it('does not auto-link obfuscated emails', () => {
      const result = sanitizeHtml('user at gmail dot com');
      expect(result).not.toContain('mailto:');
      expect(result).not.toContain('<a');
    });

    it('auto-links email alongside URL in same content', () => {
      const result = sanitizeHtml('<p>Email me@test.com or visit https://test.com</p>');
      expect(result).toContain('href="mailto:me@test.com"');
      expect(result).toContain('href="https://test.com"');
    });

    it('does not auto-link email inside <code>', () => {
      const result = sanitizeHtml('<code>user@example.com</code>');
      expect(result).not.toContain('mailto:');
    });

    it('excludes trailing period from auto-linked URL', () => {
      const result = sanitizeHtml('Visit https://example.com.');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('example.com</a>.');
    });

    it('excludes trailing comma from auto-linked URL', () => {
      const result = sanitizeHtml('See https://example.com, and more');
      expect(result).toContain('href="https://example.com"');
    });

    it('excludes trailing parenthesis from auto-linked URL', () => {
      const result = sanitizeHtml('(https://example.com)');
      expect(result).toContain('href="https://example.com"');
    });

    it('excludes trailing semicolon from auto-linked URL', () => {
      const result = sanitizeHtml('url: https://example.com;');
      expect(result).toContain('href="https://example.com"');
    });

    it('excludes trailing punctuation from URL with path', () => {
      const result = sanitizeHtml('https://example.com/path?q=1#frag.');
      expect(result).toContain('href="https://example.com/path?q=1#frag"');
    });

    it('does not misclassify a URL containing @ as an email', () => {
      const result = sanitizeHtml('See https://medium.com/@author/post here');
      expect(result).toContain('href="https://medium.com/@author/post"');
      expect(result).not.toContain('mailto:');
    });

    it('auto-links entity-encoded bare URLs from HN API', () => {
      // HN encodes slashes as &#x2F; in its API responses
      const result = sanitizeHtml('site: https:&#x2F;&#x2F;www.example.com');
      expect(result).toContain('href="https://www.example.com"');
    });

    it('does not auto-link a leading-dot email like .user@example.com', () => {
      const result = sanitizeHtml('.user@example.com');
      // The valid substring "user@example.com" may still match, but the
      // leading dot must not be part of the linked address.
      expect(result).not.toContain('href="mailto:.user@example.com"');
    });

    it('does not auto-link consecutive-dot emails like user..name@test.com', () => {
      const result = sanitizeHtml('user..name@test.com');
      expect(result).not.toContain('href="mailto:user..name@test.com"');
    });

    it('does not auto-link bare-special-char locals like %@example.com', () => {
      const result = sanitizeHtml('%@example.com');
      expect(result).not.toContain('mailto:');
    });

    it('does not auto-link dot-only locals like .@test.com or ..@test.com', () => {
      expect(sanitizeHtml('.@test.com')).not.toContain('mailto:');
      expect(sanitizeHtml('..@test.com')).not.toContain('mailto:');
    });

    it('does not auto-link emails with leading-dot domains like user@.example.com', () => {
      const result = sanitizeHtml('user@.example.com');
      expect(result).not.toContain('mailto:');
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

  describe('HN/self link rewriting', () => {
    describe('HN item href', () => {
      it('rewrites canonical https item link', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/item?id=45615867">link</a>');
        expect(result).toContain('href="#/item/45615867"');
        expect(result).not.toContain('news.ycombinator.com');
      });

      it('rewrites http variant', () => {
        const result = sanitizeHtml('<a href="http://news.ycombinator.com/item?id=45615867">link</a>');
        expect(result).toContain('href="#/item/45615867"');
      });

      it('rewrites www subdomain variant', () => {
        const result = sanitizeHtml('<a href="https://www.news.ycombinator.com/item?id=45615867">link</a>');
        expect(result).toContain('href="#/item/45615867"');
      });

      it('prefers numeric URL fragment over id query param (?id=A#B)', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/item?id=111#222">link</a>');
        expect(result).toContain('href="#/item/222"');
      });

      it('falls back to id query param when fragment is non-numeric', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/item?id=111#non-numeric">link</a>');
        expect(result).toContain('href="#/item/111"');
      });

      it('leaves /item with no id unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/item">link</a>');
        expect(result).toContain('href="https://news.ycombinator.com/item"');
      });

      it('rewrites /item/?id=X with trailing slash on path', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/item/?id=45615867">link</a>');
        expect(result).toContain('href="#/item/45615867"');
      });

      it('rewrites protocol-relative HN URL using current location as base', () => {
        const result = sanitizeHtml('<a href="//news.ycombinator.com/item?id=45615867">link</a>');
        expect(result).toContain('href="#/item/45615867"');
      });
    });

    describe('HN from href', () => {
      it('rewrites simple domain', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/from?site=example.com">link</a>');
        expect(result).toContain('href="#/from/example.com"');
      });

      it('preserves single path segment in site param', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/from?site=github.com/torvalds">link</a>');
        expect(result).toContain('href="#/from/github.com/torvalds"');
      });

      it('leaves empty site param unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/from?site=">link</a>');
        expect(result).toContain('href="https://news.ycombinator.com/from?site="');
      });

      it('leaves site param with disallowed chars unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/from?site=evil%23xss">link</a>');
        expect(result).not.toContain('href="#/from/');
      });

      it('leaves /from with no site param unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/from">link</a>');
        expect(result).toContain('href="https://news.ycombinator.com/from"');
      });

      it('rewrites /from/?site=X with trailing slash on path', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/from/?site=example.com">link</a>');
        expect(result).toContain('href="#/from/example.com"');
      });
    });

    describe('HN user href', () => {
      it('rewrites canonical https user link', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/user?id=pg">link</a>');
        expect(result).toContain('href="#/user/pg"');
        expect(result).not.toContain('news.ycombinator.com');
      });

      it('preserves username case (HN is case-sensitive)', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/user?id=PaulG">link</a>');
        expect(result).toContain('href="#/user/PaulG"');
      });

      it('accepts dashes and underscores in username', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/user?id=foo_bar-baz">link</a>');
        expect(result).toContain('href="#/user/foo_bar-baz"');
      });

      it('rewrites http variant', () => {
        const result = sanitizeHtml('<a href="http://news.ycombinator.com/user?id=pg">link</a>');
        expect(result).toContain('href="#/user/pg"');
      });

      it('rewrites www subdomain variant', () => {
        const result = sanitizeHtml('<a href="https://www.news.ycombinator.com/user?id=pg">link</a>');
        expect(result).toContain('href="#/user/pg"');
      });

      it('rewrites /user/?id=X with trailing slash on path', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/user/?id=pg">link</a>');
        expect(result).toContain('href="#/user/pg"');
      });

      it('leaves /user with no id unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/user">link</a>');
        expect(result).toContain('href="https://news.ycombinator.com/user"');
      });

      it('leaves /user with too-short username unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/user?id=a">link</a>');
        expect(result).not.toContain('href="#/user/');
      });

      it('leaves /user with too-long username unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/user?id=abcdefghijklmnop">link</a>');
        expect(result).not.toContain('href="#/user/');
      });

      it('leaves /user with illegal chars in username unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/user?id=evil%23xss">link</a>');
        expect(result).not.toContain('href="#/user/');
      });
    });

    describe('HN submitted href', () => {
      it('rewrites canonical https submitted link', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/submitted?id=pg">link</a>');
        expect(result).toContain('href="#/submitted/pg"');
        expect(result).not.toContain('news.ycombinator.com');
      });

      it('preserves username case', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/submitted?id=PaulG">link</a>');
        expect(result).toContain('href="#/submitted/PaulG"');
      });

      it('rewrites /submitted/?id=X with trailing slash on path', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/submitted/?id=pg">link</a>');
        expect(result).toContain('href="#/submitted/pg"');
      });

      it('leaves /submitted with no id unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/submitted">link</a>');
        expect(result).toContain('href="https://news.ycombinator.com/submitted"');
      });

      it('leaves /submitted with illegal chars in username unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/submitted?id=evil%23xss">link</a>');
        expect(result).not.toContain('href="#/submitted/');
      });
    });

    describe('HN feed href', () => {
      it('rewrites /show', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/show">link</a>');
        expect(result).toContain('href="#/show"');
      });

      it('rewrites /ask', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/ask">link</a>');
        expect(result).toContain('href="#/ask"');
      });

      it('rewrites /best', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/best">link</a>');
        expect(result).toContain('href="#/best"');
      });

      it('drops query string on feed rewrite', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/show?p=2">link</a>');
        expect(result).toContain('href="#/show"');
        expect(result).not.toContain('p=2');
      });
    });

    describe('self (HackerTok) href', () => {
      it('rewrites hash-form item link', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/#/item/47816960">link</a>');
        expect(result).toContain('href="#/item/47816960"');
      });

      it('rewrites non-hash item link (skips redirect script)', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/item/47816960">link</a>');
        expect(result).toContain('href="#/item/47816960"');
      });

      it('rewrites self /#/from/<site>', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/#/from/example.com">link</a>');
        expect(result).toContain('href="#/from/example.com"');
      });

      it('rewrites self non-hash /from/<site>', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/from/example.com">link</a>');
        expect(result).toContain('href="#/from/example.com"');
      });

      it('rewrites self /#/show', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/#/show">link</a>');
        expect(result).toContain('href="#/show"');
      });

      it('rewrites self non-hash /show', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/show">link</a>');
        expect(result).toContain('href="#/show"');
      });

      it('rewrites self /#/user/<username>', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/#/user/pg">link</a>');
        expect(result).toContain('href="#/user/pg"');
      });

      it('rewrites self non-hash /user/<username>', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/user/pg">link</a>');
        expect(result).toContain('href="#/user/pg"');
      });

      it('rewrites self /#/submitted/<username>', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/#/submitted/pg">link</a>');
        expect(result).toContain('href="#/submitted/pg"');
      });

      it('rewrites self non-hash /submitted/<username>', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/submitted/pg">link</a>');
        expect(result).toContain('href="#/submitted/pg"');
      });

      // `parseSelf` re-applies USERNAME_REGEX on its own (not just `parseHnUser`),
      // so a future "simplify the user path" refactor needs to fail here.
      it('leaves self /user/<bad-username> unchanged', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/user/evil%23xss">link</a>');
        expect(result).toContain('href="https://hackertok.github.io/user/evil%23xss"');
        expect(result).not.toContain('href="#/user/');
      });

      it('leaves self /submitted/<bad-username> unchanged', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/submitted/evil%23xss">link</a>');
        expect(result).toContain('href="https://hackertok.github.io/submitted/evil%23xss"');
        expect(result).not.toContain('href="#/submitted/');
      });

      it('rewrites runtime-host self link (jsdom hostname is localhost)', () => {
        const result = sanitizeHtml('<a href="http://localhost/#/item/47816960">link</a>');
        expect(result).toContain('href="#/item/47816960"');
      });

      // Exercises the host-relative path that `parseSafeUrl`'s base-URL
      // resolution was added to support (`/item/123` resolved against the
      // current location). Without the base, `new URL('/item/123')` throws.
      it('rewrites host-relative item link on self host (jsdom hostname is localhost)', () => {
        const result = sanitizeHtml('<a href="/item/47816960">link</a>');
        expect(result).toContain('href="#/item/47816960"');
      });

      it('leaves self link with unknown route unchanged', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/foo">link</a>');
        expect(result).toContain('href="https://hackertok.github.io/foo"');
      });

      // `parseSelf` re-applies SITE_REGEX on its own (not just `parseHnFrom`),
      // so a future "simplify the from path" refactor needs to fail here.
      it('leaves self /from/<bad-site> unchanged', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/from/evil%23xss">link</a>');
        expect(result).toContain('href="https://hackertok.github.io/from/evil%23xss"');
        expect(result).not.toContain('href="#/from/');
      });

      it('leaves a non-self *.github.io host unchanged', () => {
        const result = sanitizeHtml('<a href="https://other.github.io/#/item/47816960">link</a>');
        expect(result).toContain('href="https://other.github.io/#/item/47816960"');
      });

      it('rewrites self non-hash item link with trailing slash', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/item/47816960/">link</a>');
        expect(result).toContain('href="#/item/47816960"');
      });
    });

    describe('visible-text replacement', () => {
      it('replaces auto-linkified HN item URL with item:<id>', () => {
        const url = 'https://news.ycombinator.com/item?id=45615867';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>item:45615867</a>');
      });

      it('replaces auto-linkified HN ?id=A#B with item:B (matches rewritten href)', () => {
        const url = 'https://news.ycombinator.com/item?id=111#222';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>item:222</a>');
      });

      it('replaces auto-linkified HN /from with from:<site>', () => {
        const url = 'https://news.ycombinator.com/from?site=example.com';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>from:example.com</a>');
      });

      it('replaces auto-linkified HN /show with /show', () => {
        const url = 'https://news.ycombinator.com/show';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>/show</a>');
      });

      it('replaces auto-linkified HN /ask with /ask', () => {
        const url = 'https://news.ycombinator.com/ask';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>/ask</a>');
      });

      it('replaces auto-linkified HN /best with /best', () => {
        const url = 'https://news.ycombinator.com/best';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>/best</a>');
      });

      it('replaces auto-linkified self hash item URL with item:<id>', () => {
        const url = 'https://hackertok.github.io/#/item/47816960';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>item:47816960</a>');
      });

      it('replaces auto-linkified self non-hash item URL with item:<id>', () => {
        const url = 'https://hackertok.github.io/item/47816960';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>item:47816960</a>');
      });

      it('replaces auto-linkified HN /user with user:<username>', () => {
        const url = 'https://news.ycombinator.com/user?id=pg';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>user:pg</a>');
      });

      it('replaces auto-linkified HN /submitted with submitted:<username>', () => {
        const url = 'https://news.ycombinator.com/submitted?id=pg';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>submitted:pg</a>');
      });

      it('replaces auto-linkified self hash user URL with user:<username>', () => {
        const url = 'https://hackertok.github.io/#/user/pg';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>user:pg</a>');
      });

      it('replaces auto-linkified self non-hash user URL with user:<username>', () => {
        const url = 'https://hackertok.github.io/user/pg';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>user:pg</a>');
      });

      it('replaces auto-linkified self hash submitted URL with submitted:<username>', () => {
        const url = 'https://hackertok.github.io/#/submitted/pg';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>submitted:pg</a>');
      });

      it('replaces auto-linkified self non-hash submitted URL with submitted:<username>', () => {
        const url = 'https://hackertok.github.io/submitted/pg';
        const result = sanitizeHtml(`<a href="${url}">${url}</a>`);
        expect(result).toContain('>submitted:pg</a>');
      });

      it('preserves custom anchor text for HN links', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/item?id=45615867">this thread</a>');
        expect(result).toContain('href="#/item/45615867"');
        expect(result).toContain('>this thread</a>');
      });

      it('preserves custom anchor text for self links', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/#/item/47816960">linked above</a>');
        expect(result).toContain('href="#/item/47816960"');
        expect(result).toContain('>linked above</a>');
      });

      it('still triggers replacement when text has surrounding whitespace', () => {
        const url = 'https://news.ycombinator.com/item?id=45615867';
        const result = sanitizeHtml(`<a href="${url}">  ${url}  </a>`);
        expect(result).toContain('>item:45615867</a>');
      });

      // HN clips long display URLs at a fixed length and appends "..." while
      // keeping the full URL in href (verified against the real Algolia API
      // payload for item 26998308, comment 26999694).
      it('replaces HN-truncated /from URL (text "<prefix>..." vs full href)', () => {
        const href = 'https://news.ycombinator.com/from?site=scattered-thoughts.net';
        const text = 'https://news.ycombinator.com/from?site=scattered-thoughts.ne...';
        const result = sanitizeHtml(`<a href="${href}">${text}</a>`);
        expect(result).toContain('href="#/from/scattered-thoughts.net"');
        expect(result).toContain('>from:scattered-thoughts.net</a>');
      });

      it('replaces HN-truncated /item URL (text "<prefix>..." vs full href)', () => {
        const href = 'https://news.ycombinator.com/item?id=45615867';
        const text = 'https://news.ycombinator.com/item?id=4561...';
        const result = sanitizeHtml(`<a href="${href}">${text}</a>`);
        expect(result).toContain('href="#/item/45615867"');
        expect(result).toContain('>item:45615867</a>');
      });

      // The hook comment in `isAutoLinkifiedText` cites HN's mid-URL `<i>`
      // truncation as a motivating example. Lock in that this pattern works
      // so a future "tighten the check to a single text node" refactor would
      // fail loudly here.
      it('replaces HN URL split across inline children (mid-URL <i> pattern)', () => {
        const result = sanitizeHtml(
          '<a href="https://news.ycombinator.com/item?id=45615867">https://news.y<i>combinator.com/item?id=4561</i>5867</a>',
        );
        expect(result).toContain('href="#/item/45615867"');
        expect(result).toContain('>item:45615867</a>');
        expect(result).not.toContain('<i>');
      });

      // Robustness: the check is byte-shape agnostic, so any future HN
      // truncation strategy (Unicode ellipsis, mid-URL truncation, etc.)
      // still gets the friendly label as long as the visible text begins
      // with the original URL's origin.
      it('replaces HN-truncated URL using Unicode ellipsis', () => {
        const href = 'https://news.ycombinator.com/from?site=example.com';
        const text = 'https://news.ycombinator.com/from?site=ex\u2026';
        const result = sanitizeHtml(`<a href="${href}">${text}</a>`);
        expect(result).toContain('href="#/from/example.com"');
        expect(result).toContain('>from:example.com</a>');
      });

      it('does not replace custom anchor text that ends with "..."', () => {
        const result = sanitizeHtml(
          '<a href="https://news.ycombinator.com/item?id=45615867">click here...</a>',
        );
        expect(result).toContain('href="#/item/45615867"');
        expect(result).toContain('>click here...</a>');
      });
    });

    describe('negative cases', () => {
      it('leaves news.ycombinator.com/newest unchanged', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/newest">link</a>');
        expect(result).toContain('href="https://news.ycombinator.com/newest"');
      });

      it('leaves unrelated hosts unchanged', () => {
        const result = sanitizeHtml('<a href="https://example.com/item?id=45615867">link</a>');
        expect(result).toContain('href="https://example.com/item?id=45615867"');
      });

      it('leaves malformed href values unchanged', () => {
        const result = sanitizeHtml('<a href="not a url">link</a>');
        expect(result).toContain('>link</a>');
        expect(result).not.toContain('href="#/');
      });
    });

    describe('regression', () => {
      it('rewritten HN link still carries rel="noreferrer"', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/item?id=45615867">link</a>');
        expect(result).toContain('rel="noreferrer"');
      });

      it('rewritten self link still carries rel="noreferrer"', () => {
        const result = sanitizeHtml('<a href="https://hackertok.github.io/#/item/47816960">link</a>');
        expect(result).toContain('rel="noreferrer"');
      });
    });

    describe('defensive', () => {
      it('handles <a name="anchor"> with no href as a no-op', () => {
        const result = sanitizeHtml('<a name="anchor">text</a>');
        expect(result).toContain('>text</a>');
        expect(result).not.toContain('href="#/');
      });

      it('handles <a href=""> as a no-op (resolves to current location root, no route match)', () => {
        const result = sanitizeHtml('<a href="">text</a>');
        expect(result).toContain('>text</a>');
        expect(result).not.toContain('href="#/');
      });

      it('handles <a href="/relative"> as a no-op', () => {
        const result = sanitizeHtml('<a href="/relative">text</a>');
        expect(result).toContain('href="/relative"');
        expect(result).toContain('>text</a>');
      });

      it('rewrites href but preserves text when child contains hostile script', () => {
        const result = sanitizeHtml('<a href="https://news.ycombinator.com/item?id=45615867"><script>alert(1)</script></a>');
        expect(result).toContain('href="#/item/45615867"');
        expect(result).not.toContain('<script>');
        expect(result).not.toContain('alert');
      });
    });
  });
});

// The link-rewriting hook lives on a private DOMPurify instance so it does
// not leak to the default singleton that other code might import. If this
// test ever fails, the hook has been re-attached to the global instance and
// is silently affecting every consumer that calls `DOMPurify.sanitize`.
describe('module-level isolation', () => {
  it('does not register the hook on the default DOMPurify singleton', () => {
    const result = DOMPurify.sanitize(
      '<a href="https://news.ycombinator.com/item?id=45615867">x</a>',
    );
    expect(result).toContain('href="https://news.ycombinator.com/item?id=45615867"');
    expect(result).not.toContain('href="#/item/');
    expect(result).not.toContain('rel="noreferrer"');
  });
});

import DOMPurify, { type Config } from 'dompurify';

type DOMPurifyFactory = (w: Window) => typeof DOMPurify;

// Single source for the browser-environment guard used by the private
// DOMPurify instance, runtime self-host detection, and base URL resolution.
const browserLocation: Location | null =
  typeof window !== 'undefined' && window.location ? window.location : null;

// Private DOMPurify instance so the link-rewriting hook below is scoped to
// this module; importing `dompurify` elsewhere gets the unmodified default
// singleton. Module load requires a DOM (browser or jsdom): in pure Node,
// the imported `DOMPurify` is a bare factory with no `.addHook`, so the
// `: DOMPurify` fallback would throw at hook registration. HackerTok runs
// only in browsers and jsdom, where `browserLocation` is never null.
const purify = browserLocation
  ? (DOMPurify as unknown as DOMPurifyFactory)(window)
  : DOMPurify;

const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'a', 'b', 'i', 'u', 'strong', 'em', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'span', 'div',
  ],
  ALLOWED_ATTR: ['href', 'class', 'id'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

// Validates that a /from site param looks like a domain (with optional single
// path segment). Accepts e.g. `example.com`, `github.com/torvalds`. Rejects
// fragments, query strings, multi-segment paths, spaces, and empty input.
const SITE_REGEX = /^[a-z0-9.-]+(?:\/[a-z0-9._-]+)?$/i;

// HN's allowed username pattern: 2–15 chars, alphanumeric plus `_` and `-`.
// Case is preserved verbatim — Firebase, Algolia, and HN itself all treat
// usernames as case-sensitive (e.g. `pg` and `PG` are distinct accounts).
// Used at 4 callsites: parseHnUser, parseHnSubmitted, and the two self-host
// matches in parseSelf — keep them in sync via this single source.
const USERNAME_REGEX = /^[a-zA-Z0-9_-]{2,15}$/;

// Supported feed routes → display labels.
const FEED_LABELS = new Map<string, string>([
  ['/show', '/show'],
  ['/ask', '/ask'],
  ['/best', '/best'],
]);

// Canonical self-host; `window.location.hostname` also treated as self at runtime.
const SELF_HOSTS = new Set<string>(['hackertok.github.io']);

const HN_HOST = 'news.ycombinator.com';

interface RouteTarget {
  route: string;
  label: string;
}

function getRuntimeSelfHost(): string | null {
  return browserLocation?.hostname ?? null;
}

function isSelfHost(hostname: string): boolean {
  if (SELF_HOSTS.has(hostname)) return true;
  const runtime = getRuntimeSelfHost();
  return runtime !== null && hostname === runtime;
}

function parseHnItem(parsed: URL): RouteTarget | null {
  // Numeric URL fragment (e.g. ?id=A#B) wins so we deep-link to the specific
  // comment the author was pointing at.
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  if (/^\d+$/.test(hash)) {
    return { route: `#/item/${hash}`, label: `item:${hash}` };
  }
  const id = parsed.searchParams.get('id');
  if (id && /^\d+$/.test(id)) {
    return { route: `#/item/${id}`, label: `item:${id}` };
  }
  return null;
}

function parseHnFrom(parsed: URL): RouteTarget | null {
  const site = parsed.searchParams.get('site');
  if (!site || !SITE_REGEX.test(site)) return null;
  return { route: `#/from/${site}`, label: `from:${site}` };
}

function parseHnUser(parsed: URL): RouteTarget | null {
  const id = parsed.searchParams.get('id');
  if (!id || !USERNAME_REGEX.test(id)) return null;
  return { route: `#/user/${id}`, label: `user:${id}` };
}

function parseHnSubmitted(parsed: URL): RouteTarget | null {
  const id = parsed.searchParams.get('id');
  if (!id || !USERNAME_REGEX.test(id)) return null;
  return { route: `#/submitted/${id}`, label: `submitted:${id}` };
}

const TRAILING_SLASHES = /\/+$/;

// Strip trailing slashes so `/item/` and `/item` (or `/show/` and `/show`)
// match the same case. HN doesn't normally emit trailing slashes, but
// hand-pasted URLs sometimes do.
function normalizePath(path: string): string {
  return path.replace(TRAILING_SLASHES, '') || '/';
}

function parseHn(parsed: URL): RouteTarget | null {
  const path = normalizePath(parsed.pathname);
  switch (path) {
    case '/item':
      return parseHnItem(parsed);
    case '/from':
      return parseHnFrom(parsed);
    case '/user':
      return parseHnUser(parsed);
    case '/submitted':
      return parseHnSubmitted(parsed);
    default: {
      const feed = FEED_LABELS.get(path);
      if (feed) {
        return { route: `#${path}`, label: feed };
      }
      return null;
    }
  }
}

function parseSelf(parsed: URL): RouteTarget | null {
  // Two URL forms exist in the wild because of the redirect script in
  // index.html / public/404.html:
  //   - hash form (canonical):   https://hackertok.github.io/#/item/47816960
  //   - non-hash form:           https://hackertok.github.io/item/47816960
  // Normalize to a single `inAppPath` and match path-segment regexes.
  const inAppPath = normalizePath(
    parsed.hash.startsWith('#/') ? parsed.hash.slice(1) : parsed.pathname,
  );

  const itemMatch = /^\/item\/(\d+)$/.exec(inAppPath);
  if (itemMatch) {
    const id = itemMatch[1];
    return { route: `#/item/${id}`, label: `item:${id}` };
  }

  const fromMatch = /^\/from\/(.+)$/.exec(inAppPath);
  if (fromMatch) {
    const site = fromMatch[1];
    if (SITE_REGEX.test(site)) {
      return { route: `#/from/${site}`, label: `from:${site}` };
    }
    return null;
  }

  const userMatch = /^\/user\/(.+)$/.exec(inAppPath);
  if (userMatch) {
    const id = userMatch[1];
    if (USERNAME_REGEX.test(id)) {
      return { route: `#/user/${id}`, label: `user:${id}` };
    }
    return null;
  }

  const submittedMatch = /^\/submitted\/(.+)$/.exec(inAppPath);
  if (submittedMatch) {
    const id = submittedMatch[1];
    if (USERNAME_REGEX.test(id)) {
      return { route: `#/submitted/${id}`, label: `submitted:${id}` };
    }
    return null;
  }

  const feed = FEED_LABELS.get(inAppPath);
  if (feed) {
    return { route: `#${inAppPath}`, label: feed };
  }

  return null;
}

function parseSafeUrl(href: string): URL | null {
  try {
    // Resolving against the current location lets us handle protocol-relative
    // (`//news.ycombinator.com/...`) and host-relative (`/item/123` on
    // hackertok.github.io) URLs that the bare `new URL(href)` form rejects
    // outright. Falls back to absolute-only parsing in non-browser contexts.
    return new URL(href, browserLocation?.href);
  } catch {
    return null;
  }
}

function parseTargetRoute(parsed: URL): RouteTarget | null {
  const hostname = parsed.hostname.replace(/^www\./, '');

  if (hostname === HN_HOST) {
    return parseHn(parsed);
  }

  if (isSelfHost(hostname)) {
    return parseSelf(parsed);
  }

  return null;
}

/**
 * Strips the common leading whitespace shared by every non-blank line.
 * HN's text-to-HTML converter preserves the author's source indent
 * verbatim inside `<pre>` blocks (commenters indent with 2+ spaces to
 * mark a block as code), so the rendered text inherits a 2-, 4-, or
 * 6-space hanging indent on top of our `.comment-content pre` padding
 * — wasted horizontal space, especially on mobile. Relative indent
 * inside the block is preserved (e.g. continuation lines keep their
 * inner indent under their if/for/while parent).
 */
function dedentPreText(text: string): string {
  const lines = text.split('\n');
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (minIndent === Infinity || minIndent === 0) return text;
  return lines.map((line) => line.slice(minIndent)).join('\n');
}

// HN auto-linkifies URLs by wrapping the bare URL in <a>, sometimes clipping
// long display URLs (e.g. `…/from?site=scattered-thoughts.ne...`) while
// keeping the full URL in href. Whatever the truncation strategy — literal
// `...`, Unicode `…`, mid-URL `<i>` — the visible text always starts with the
// URL's origin verbatim. Custom anchor text like "this thread" or "see here"
// essentially never starts with a fully qualified URL origin, so this check
// cleanly separates the two cases without depending on byte-level shape.
function isAutoLinkifiedText(text: string, parsed: URL): boolean {
  return text.startsWith(parsed.origin);
}

purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'PRE') {
    // Target the inner <code> when present so the <code> wrapper
    // survives (keeps `.comment-content pre code`'s background-reset
    // / font-size override applying). Falls back to the <pre> itself
    // for the rare bare-text shape.
    const firstChild = node.firstElementChild;
    const target = firstChild?.tagName === 'CODE' ? firstChild : node;
    // Skip when the block contains element descendants (e.g. an
    // auto-linkified URL — HN linkifies inside <pre> too, per
    // formatdoc). Setting `target.textContent` would wipe the <a> and
    // demote the link to plain text. Rare in real HN code blocks, but
    // we'd rather keep the link clickable than dedent at any cost.
    if (target.querySelector('*')) {
      return;
    }
    const text = target.textContent ?? '';
    const dedented = dedentPreText(text);
    if (dedented !== text) {
      target.textContent = dedented;
    }
    return;
  }
  if (node.tagName === 'A') {
    const originalHref = node.getAttribute('href');
    if (originalHref) {
      const parsed = parseSafeUrl(originalHref);
      const target = parsed && parseTargetRoute(parsed);
      if (parsed && target) {
        node.setAttribute('href', target.route);
        // afterSanitizeAttributes fires before child nodes are sanitized,
        // but hostile content like `<a><script>alert(1)</script></a>` has
        // textContent "alert(1)" which fails the origin-prefix check, so we
        // never overwrite anything sensitive. DOMPurify's main pass still
        // strips the <script> regardless. Even in the contrived case where
        // hostile children make textContent start with the URL origin (e.g.
        // `<a>HN-URL<script>...</script></a>`), the textContent overwrite
        // below removes them before they ever reach the live DOM.
        //
        // Trade-off: this also drops any custom inline annotation that
        // happens to follow a URL prefix (`<a>HN-URL <strong>(updated)
        // </strong></a>`). HN's auto-linking does not produce such markup,
        // and accepting this is the price of correctly handling HN's
        // mid-URL `<i>` truncation pattern without fragile DOM shape checks.
        if (isAutoLinkifiedText((node.textContent ?? '').trim(), parsed)) {
          node.textContent = target.label;
        }
      }
    }
    node.setAttribute('rel', 'noreferrer');
  }
});

/**
 * Wraps bare `http(s)://` URLs and email addresses in text nodes with
 * `<a>` tags so DOMPurify's afterSanitizeAttributes hook can add
 * `rel="noreferrer"` and rewrite HN / self-host links automatically.
 * Skips text inside existing `<a>`, `<code>`, and `<pre>` elements to
 * avoid double-linking or mangling code blocks.
 */

// Match URLs and emails in a single pass (module-level to avoid
// recompilation). The URL branch ends with a character-class that
// excludes common trailing punctuation so "Visit https://x.com."
// links only "https://x.com".
// The email branch requires alphanumeric segments separated by
// dots/special chars — rejecting leading/trailing/consecutive dots
// and bare-special-char local parts (e.g. `.@`, `..@`, `%@`).
const LINKABLE = /(https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]}>]|[a-zA-Z0-9]+(?:[._%+-][a-zA-Z0-9]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,})/g;

function autoLinkUrls(html: string): string {
  if (typeof document === 'undefined') return html;

  // Fast path: skip DOM work when there's nothing that could match.
  // Check for 'http' (not '://') because HN entity-encodes slashes as
  // &#x2F;, so raw HTML contains "https:&#x2F;&#x2F;" not "https://".
  if (!html.includes('http') && !html.includes('@')) return html;

  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;

  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if (t.parentElement?.closest('a, code, pre')) continue;
    if (LINKABLE.test(t.textContent || '')) nodes.push(t);
    LINKABLE.lastIndex = 0;
  }

  // Nothing to link — return original HTML without serializing.
  if (nodes.length === 0) return html;

  for (const textNode of nodes) {
    const parts = textNode.textContent.split(LINKABLE);
    if (parts.length <= 1) continue;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      if (i % 2 === 1) {
        // Odd index = captured match (URL or email).
        const a = document.createElement('a');
        a.href = parts[i].startsWith('http') ? parts[i] : `mailto:${parts[i]}`;
        a.textContent = parts[i];
        frag.appendChild(a);
      } else {
        frag.appendChild(document.createTextNode(parts[i]));
      }
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  const div = document.createElement('div');
  div.appendChild(fragment);
  return div.innerHTML;
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html || typeof html !== 'string') {
    return '';
  }
  return purify.sanitize(autoLinkUrls(html), PURIFY_CONFIG);
}

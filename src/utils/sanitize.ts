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

// Single source of truth for the supported HN feeds and their friendly labels.
// Feeds are nullary destinations (no value), so their labels are the route
// path itself rather than the operator-style `kind:value` shape used for
// item/from/user links. This keeps every label honest about what it points to.
const FEED_LABELS = new Map<string, string>([
  ['/show', '/show'],
  ['/ask', '/ask'],
  ['/best', '/best'],
]);

// Hardcoded canonical self-host. The current `window.location.hostname` is
// also treated as self at runtime so dev (`localhost`) and any preview
// deployments work without additional configuration.
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

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html || typeof html !== 'string') {
    return '';
  }
  return purify.sanitize(html, PURIFY_CONFIG);
}

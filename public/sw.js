/*
 * HackerTok service worker — minimal, dependency-free offline app shell.
 *
 * Goal: an installed PWA cold-boots OFFLINE, serving the HTML shell + the current
 * build's hashed JS/CSS from cache. Third-party content (Algolia, Firebase RTDB
 * over wss://) is cross-origin and skipped entirely, so the feed/comments stay
 * live and Playwright's network mocks keep working.
 *
 * Hand-rolled rather than vite-plugin-pwa / Workbox: Vite already content-hashes
 * assets (new build = new URL = cache miss = fresh fetch), making Workbox's
 * revisioned precache manifest redundant, and nothing cross-origin is cached, so
 * its runtime strategies are non-goals. What remains is ~100 auditable,
 * zero-dependency lines. Registration is a bundled import (main.tsx), so the
 * hash-based CSP stays clean; `worker-src 'self'` (vite.config.js) authorizes it.
 *
 * Two caches: an install-time SHELL precache and a bounded RUNTIME cache for
 * hashed assets, FIFO-trimmed to MAX_RUNTIME_ENTRIES so stale chunks from prior
 * deploys can't accumulate between VERSION bumps.
 */

// Cache-schema version, NOT the app/GitHub release. Bump only when the caching
// contract changes (PRECACHE_URLS, cache layout, or a precached file like the
// manifest/icon); app-code releases self-bust via content-hashing + network-first
// navigation. A bump renames the caches, so `activate` wipes the old ones.
const VERSION = 'v1';
const SHELL_CACHE = `hackertok-shell-${VERSION}`;
const RUNTIME_CACHE = `hackertok-runtime-${VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, RUNTIME_CACHE]);
const OFFLINE_SHELL = '/index.html';

// Cap on cached same-origin assets. One build ships well under this, so the
// current shell always fits while stale entries from older deploys evict first.
const MAX_RUNTIME_ENTRIES = 64;

// How long a navigation waits on the network before falling back to the cached
// shell. Bounds "lie-fi" launches (connected but stalled) that would otherwise
// hang on the browser's own ~30–60s timeout. The request is NOT abandoned at the
// cutoff — it keeps running to refresh the shell for the next launch.
const NETWORK_TIMEOUT_MS = 3000;
const PUSH_ONLY_DEV = new URL(self.location.href).searchParams.has('push-dev');

// Static shell precached up-front. The build's hashed JS/CSS can't be listed here
// (names are unknown at author time) — `install` parses them from the cached shell
// HTML instead, so the first visit alone is enough to boot offline.
const PRECACHE_URLS = ['/', OFFLINE_SHELL, '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  if (PUSH_ONLY_DEV) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(PRECACHE_URLS);

      // Precache this build's hashed bundles by parsing their /assets/* refs out of
      // the shell HTML cached above. The SW doesn't control the first navigation, so
      // those requests never reach the fetch handler — without this they'd be cached
      // only on a later controlled load, defeating first-visit offline boot.
      // Best-effort: any failure just defers to runtime caching.
      try {
        const shellResponse = await shell.match(OFFLINE_SHELL);
        const html = shellResponse ? await shellResponse.text() : '';
        const assets = [...new Set(Array.from(html.matchAll(/["'](\/assets\/[^"']+)["']/g), (m) => m[1]))];
        if (assets.length) {
          const runtime = await caches.open(RUNTIME_CACHE);
          await runtime.addAll(assets);
        }
      } catch {
        /* defer to runtime caching on the next controlled load */
      }

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  if (PUSH_ONLY_DEV) {
    event.waitUntil(self.clients.claim());
    return;
  }
  // Drop caches from older versions, then take control of open clients.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CURRENT_CACHES.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const PUSH_ICON = '/icons/icon.svg';
const GENERIC_NOTIFICATION = {
  title: 'HackerTok',
  options: {
    body: 'Story alerts are ready.',
    icon: PUSH_ICON,
    tag: 'hackertok-alert',
    renotify: false,
    data: {},
  },
};

function validAlertPayload(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.version === 1 &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    value.title.length <= 300 &&
    Number.isSafeInteger(value.score) &&
    value.score > 1000
  );
}

self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    payload = undefined;
  }

  const notification = validAlertPayload(payload)
    ? {
        title: payload.title.trim(),
        options: {
          body: `${payload.score.toLocaleString('en-US')} points on Hacker News`,
          icon: PUSH_ICON,
          tag: `hn-${payload.id}`,
          renotify: false,
          data: { id: payload.id },
        },
      }
    : GENERIC_NOTIFICATION;

  // Web Push requires a visible notification for every received push. Even a
  // malformed or empty payload therefore gets a safe, destination-free fallback.
  event.waitUntil(
    self.registration.showNotification(notification.title, notification.options),
  );
});

async function focusOrOpenNotification(id) {
  const validId = Number.isSafeInteger(id) && id > 0;
  const destination = new URL(
    validId ? `/#/item/${id}` : '/#/',
    self.location.origin,
  );
  const windows = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const sameOrigin = windows.filter((client) => {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  const exact = sameOrigin.find((client) => client.url === destination.href);
  if (exact) {
    await exact.focus();
    return;
  }
  const existing = sameOrigin[0];
  if (existing) {
    try {
      const navigated = await existing.navigate(destination.href);
      await (navigated ?? existing).focus();
      return;
    } catch {
      /* Fall through to a new same-origin window. */
    }
  }
  await self.clients.openWindow(destination.href);
}

self.addEventListener('notificationclick', (event) => {
  event.waitUntil(
    (async () => {
      event.notification.close();
      const id = event.notification.data?.id;
      await focusOrOpenNotification(id);
    })(),
  );
});

// FIFO-trim the runtime cache. Cache.keys() returns entries in insertion order,
// so deleting from the front evicts the oldest (least-recently-written) assets.
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

// Network-first navigation, bounded by NETWORK_TIMEOUT_MS, falling back to the
// cached shell. Online users get the freshest index.html (and its newest hashed
// bundles); offline / lie-fi users get the cached shell promptly.
async function navigate(event) {
  const { request } = event;
  const network = fetch(request);

  // Refresh the offline shell only from a genuine root navigation. GitHub Pages
  // serves unknown paths (e.g. a shared /item/123 deep link) as 404.html with a
  // 200, so caching a non-root document here would poison the shell. Only `/` is
  // guaranteed to be the real index.html.
  const refreshShell = (response) => {
    if (new URL(request.url).pathname !== '/' || !response.ok) return undefined;
    // Clone synchronously. On the success path refreshShell runs before
    // `return response`, so the copy is taken before the body is handed to the page.
    // Deferring the clone into the caches.open().then() would instead read it after
    // the body is already disturbed — clone() throws, the .catch() swallows it, and
    // the shell silently never refreshes (it would then stay pinned to an old build
    // across app-only deploys until its hashed bundles get evicted).
    const copy = response.clone();
    return caches.open(SHELL_CACHE).then((cache) => cache.put(OFFLINE_SHELL, copy));
  };

  try {
    const response = await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('nav-timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    event.waitUntil(Promise.resolve(refreshShell(response)).catch(() => {}));
    return response;
  } catch {
    // Timed out or the network failed. Serve the cached shell if we have one; on a
    // brand-new install whose precache hasn't landed yet, fall through to the
    // still-running network request.
    const cached =
      (await caches.match(OFFLINE_SHELL, { ignoreVary: true })) || (await caches.match('/', { ignoreVary: true }));
    if (!cached) return network;
    // Keep the slow request alive: a late success still refreshes the shell for the
    // next launch. Swallow its rejection (offline) to avoid an unhandled rejection.
    event.waitUntil(
      network
        .then((response) => refreshShell(response))
        .catch(() => {}),
    );
    return cached;
  }
}

self.addEventListener('fetch', (event) => {
  if (PUSH_ONLY_DEV) return;
  const { request } = event;

  // Never touch non-GET or cross-origin (Algolia / Firebase / external links):
  // let them hit the network (and any Playwright route mocks) untouched.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigations: see navigate() (network-first + cached-shell fallback).
  if (request.mode === 'navigate') {
    event.respondWith(navigate(event));
    return;
  }

  // Same-origin static assets (hashed JS/CSS, icons, manifest): cache-first.
  // Content-hashing keeps a cached copy permanently fresh (a changed file ships a
  // new URL), and it skips GitHub Pages' max-age=600 revalidation every 10 min.
  // The read checks every cache, so precached shell assets stay pinned in
  // SHELL_CACHE until a VERSION bump. `ignoreVary` bridges a real mismatch: the
  // install precache stores plain SW Requests, but the browser's module requests
  // are `crossorigin`, and the asset's `Vary` differs by host (`vite preview` sends
  // `Vary: Origin`, GitHub Pages `Vary: Accept-Encoding`) — a strict match could
  // miss the precached bundle and fail offline. Hashed URLs are single-variant, so
  // ignoring Vary is safe.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          // Swallow write failures (e.g. QuotaExceededError under storage
          // pressure): the response is already returned, so the cache write must
          // not surface as an unhandled extend-lifetime rejection.
          event.waitUntil(
            caches
              .open(RUNTIME_CACHE)
              .then((cache) => cache.put(request, copy).then(() => trimCache(cache, MAX_RUNTIME_ENTRIES)))
              .catch(() => {}),
          );
        }
        return response;
      });
    }),
  );
});

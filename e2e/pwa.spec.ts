import { test, expect } from './fixtures/test';
import { setupApiMocks } from './fixtures/api-mocks';
import type { Page } from '@playwright/test';

/**
 * Wait for the service worker to take control of the page.
 */
async function waitForSwControl(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  });
}

/**
 * Wait until at least one hashed JS bundle is cached. Scans every cache rather
 * than the SW's version-specific name, so a VERSION bump can't silently break it.
 */
async function waitForCachedBundle(page: Page) {
  await page.waitForFunction(
    async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        if (keys.some((req) => req.url.includes('/assets/') && req.url.endsWith('.js'))) {
          return true;
        }
      }
      return false;
    },
    undefined,
    { timeout: 10_000 },
  );
}

/**
 * PWA offline app shell.
 *
 * The rest of the suite blocks service workers (playwright.config.ts) to exercise
 * the live network; this spec opts back in. It proves the SW lets the app cold-boot
 * OFFLINE after the very FIRST visit — install precaches the shell AND this build's
 * hashed bundles, so a fully offline reload still renders the shell from cache
 * rather than a browser error page.
 *
 * Chromium only: SW + offline emulation is most reliable there, and the SW is
 * identical across browsers.
 */
test.describe('PWA offline app shell', () => {
  test.use({ serviceWorkers: 'allow' });

  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'SW offline behavior validated in Chromium');
  });

  test('cold-boots offline after a single online visit', async ({ page, context }) => {
    await setupApiMocks(page);

    // 1. One online visit registers + activates the SW (skipWaiting +
    //    clients.claim), so it takes control of this page.
    await page.goto('/');
    await waitForSwControl(page);

    // 2. Assert a JS bundle is in the SW cache after this FIRST visit — no reload.
    //    This is the cold-boot guarantee: it would fail if bundles were only cached
    //    lazily on a later load, and unlike the offline render it's independent of
    //    the HTTP cache.
    await waitForCachedBundle(page);

    // 3. Go fully offline and reload — only the SW can satisfy the navigation
    //    + same-origin bundles now.
    await context.setOffline(true);
    await page.reload();

    // 4. The shell still renders, and the SW is still in control.
    await expect(page.locator('header').first()).toBeVisible();
    const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
    expect(controlled).toBe(true);
  });

  test('shows the offline bar on a cold reload when navigator.onLine wrongly reports online, then clears it on reconnect', async ({ page, context }) => {
    await setupApiMocks(page);

    // Reproduce real Chrome DevTools device-mode "Offline" / captive portals /
    // lie-fi, where navigator.onLine stays `true` despite no connectivity AND no
    // online/offline transition events ever fire — so the active connectivity probe
    // is the ONLY thing that can move the state in either direction. Playwright's
    // setOffline would otherwise both flip navigator.onLine to false and dispatch
    // online/offline events, masking whether the probe itself works; pin onLine to
    // `true` and swallow the events for the page's entire lifetime.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      for (const type of ['online', 'offline']) {
        window.addEventListener(type, (e) => e.stopImmediatePropagation());
      }
    });

    // 1. One online visit registers + activates the SW so it controls the reload.
    await page.goto('/');
    await waitForSwControl(page);

    // 2. Wait until a hashed bundle is cached so the offline reload can boot.
    await waitForCachedBundle(page);

    // 3. Cold offline reload: the SW serves the shell, navigator.onLine still lies
    //    "online", and no offline transition event fires — the active connectivity
    //    probe is the only thing that can reveal we're offline.
    await context.setOffline(true);
    await page.reload();

    // 4. The shell renders AND the offline bar appears (regression: it used to stay
    //    hidden because the app trusted navigator.onLine alone on a fresh load).
    await expect(page.locator('header').first()).toBeVisible();
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 10_000 });

    // 5. Reconnect. navigator.onLine is still pinned to `true`, so no `online` event
    //    fires — only the periodic connectivity re-probe can notice the link is back
    //    and clear the bar. (Without recovery the bar would stay stuck forever.)
    await context.setOffline(false);
    await expect(page.getByText('No internet connection')).toBeHidden({ timeout: 12_000 });
  });
});

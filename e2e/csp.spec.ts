import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

/**
 * Guards the build-time meta CSP (htmlMetaCsp() in vite.config.js), exercised
 * via `vite preview` of the production build. The CSP has no functional
 * footprint — a missing CSP or a dropped script hash leaves the app fully usable
 * — so these assertions are the only thing that catches a silent regression.
 */

/** Capture securitypolicyviolation events before any page script runs. */
async function collectCspViolations(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.effectiveDirective || e.violatedDirective} :: ${e.blockedURI}`,
      );
    });
  });
}

const readViolations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

test.describe('Content-Security-Policy', () => {
  test.beforeEach(async ({ page }) => {
    await collectCspViolations(page);
    await setupApiMocks(page);
  });

  test('ships exactly one enforced meta CSP', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
    await expect(meta).toHaveCount(1);

    const content = (await meta.getAttribute('content')) ?? '';
    // Core hardening directives must be present and must not regress to unsafe values.
    expect(content).toContain("default-src 'self'");
    expect(content).toContain("object-src 'none'");
    expect(content).toContain("base-uri 'self'");
    expect(content).toMatch(/script-src 'self'[^;]*'sha256-/);
    expect(content).not.toContain("script-src 'self' 'unsafe-inline'");
    // Assert connect-src endpoints by string: the violation checks below can't
    // see the WebSocket path because page.routeWebSocket replaces window.WebSocket
    // with a shim that never opens a native socket, so the browser never evaluates
    // connect-src for wss://. Deleting wss:// would ship green yet break production.
    expect(content).toContain('https://hn.algolia.com');
    expect(content).toContain('wss://*.firebaseio.com');
    expect(content).toContain(
      'frame-src https://challenges.cloudflare.com',
    );
    expect(content).toMatch(
      /script-src 'self' https:\/\/challenges\.cloudflare\.com/u,
    );
    expect(content).toMatch(
      /connect-src [^;]*https:\/\/challenges\.cloudflare\.com/u,
    );
  });

  test('raises no violations on load (Algolia-backed homepage)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(await readViolations(page)).toEqual([]);
  });

  test('raises no violations navigating to a Firebase-backed section', async ({ page }) => {
    await page.goto('/#/best', { waitUntil: 'networkidle' });
    // /#/best reads over wss://<shard>.firebaseio.com. Assert the data rendered
    // (layout-agnostic: title is in the DOM for both list and swipe) so the wss
    // connection is actually exercised; a blocked wss:// would raise a violation.
    await expect(page.locator('#root')).toContainText('The Art of Finishing Projects', {
      timeout: 10_000,
    });
    expect(await readViolations(page)).toEqual([]);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

const storedMode = (page: Page) =>
  page.evaluate(() => localStorage.getItem('setting:theme'));

test.describe('Theme cycle button', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => localStorage.clear());
  });

  test('cycles system → light → dark → system', async ({ page }) => {
    await page.goto('/#/');

    const html = page.locator('html');
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();

    // Default is system (no stored choice); OS is light here → resolves light.
    await expect(html).toHaveClass(/light/);
    expect(await storedMode(page)).toBeNull();

    // system → light
    await toggle.click();
    await expect.poll(() => storedMode(page)).toBe('light');
    await expect(html).toHaveClass(/light/);

    // light → dark
    await toggle.click();
    await expect.poll(() => storedMode(page)).toBe('dark');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);

    // dark → system (OS is light → resolves light again)
    await toggle.click();
    await expect.poll(() => storedMode(page)).toBe('system');
    await expect(html).toHaveClass(/light/);
  });

  test('pinned theme persists after reload', async ({ browser, baseURL }) => {
    // Multiple page loads + a fresh context push past the default test timeout.
    test.setTimeout(60000);

    // Fresh context so addInitScript doesn't wipe localStorage on reload.
    const context = await browser.newContext({ baseURL, colorScheme: 'light' });
    const page = await context.newPage();
    await setupApiMocks(page);

    await page.goto('/#/');

    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();

    // system → light → dark
    await toggle.click();
    await toggle.click();
    await expect.poll(() => storedMode(page)).toBe('dark');

    await page.reload();

    await expect(page.getByTestId('theme-toggle')).toBeVisible();
    expect(await storedMode(page)).toBe('dark');

    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);

    // Don't call context.close() — Playwright's automatic teardown races with
    // explicit close and produces flaky teardown errors on CI.
  });
});

test.describe('Theme - System mode', () => {
  test('system mode (default) resolves to the OS dark preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await setupApiMocks(page);
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/#/');

    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);
  });

  test('system mode (default) resolves to the OS light preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await setupApiMocks(page);
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/#/');

    const html = page.locator('html');
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);
  });

  // Issue 2: while following the system, flipping the OS theme flips the app.
  test('system mode follows the OS theme when it changes after load', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await setupApiMocks(page);
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/#/');

    const html = page.locator('html');
    await expect(html).toHaveClass(/light/);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);
  });

  // The regression the tri-state model fixes: a pin must survive OS changes.
  test('a pinned theme is not overridden by an OS theme change', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await setupApiMocks(page);
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/#/');

    const toggle = page.getByTestId('theme-toggle');
    const html = page.locator('html');

    // system → light (explicit pin)
    await toggle.click();
    await expect.poll(() => storedMode(page)).toBe('light');
    await expect(html).toHaveClass(/light/);

    // OS flips to dark; the pinned light theme must hold.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);
  });
});

test.describe('Theme - Status bar color', () => {
  const themeColor = (page: Page) =>
    page.locator('meta[name="theme-color"]').getAttribute('content');

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.addInitScript(() => localStorage.clear());
  });

  // Issue 1: exactly one app-controlled theme-color tag, recolored on change.
  test('theme-color meta updates when pinning a dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/#/');

    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
    expect(await themeColor(page)).toBe('#fffdfb');

    // system → light → dark
    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('theme-toggle').click();

    await expect.poll(() => themeColor(page)).toBe('#241e1a');
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('theme-color meta follows the OS theme at runtime in system mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/#/');

    expect(await themeColor(page)).toBe('#fffdfb');

    await page.emulateMedia({ colorScheme: 'dark' });

    await expect.poll(() => themeColor(page)).toBe('#241e1a');
  });

  // A cold load under a dark OS must paint the dark status bar from the start
  // (bootstrap pre-paint, then ThemeProvider) — not only after a runtime flip.
  test('theme-color meta is dark on a cold load under a dark OS', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/#/');

    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
    await expect.poll(() => themeColor(page)).toBe('#241e1a');
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});

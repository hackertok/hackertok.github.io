import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

test.describe('Theme Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test('can toggle to dark mode', async ({ page }) => {
    await page.goto('/#/');

    await expect(page.getByRole('button', { name: /theme|dark|light|mode/i }).first()).toBeVisible();

    const toggle = page.getByTestId('theme-toggle');
    await toggle.click();

    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);

    await expect.poll(async () => {
      return await page.evaluate(() => localStorage.getItem('theme'));
    }, { timeout: 5000 }).toBeTruthy();
    const theme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(['dark', 'light']).toContain(theme);
  });

  test('theme persists after reload', async ({ browser, baseURL }) => {
    // Multiple page loads + a fresh context push past the default test timeout.
    test.setTimeout(60000);

    // Fresh context so addInitScript doesn't wipe localStorage on reload.
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await setupApiMocks(page);

    await page.goto('/#/');

    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();

    await toggle.click();

    await expect.poll(async () => {
      return await page.evaluate(() => localStorage.getItem('theme'));
    }, { timeout: 5000 }).toBe('dark');

    await page.reload();

    await expect(page.getByTestId('theme-toggle')).toBeVisible();

    const afterReloadTheme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(afterReloadTheme).toBe('dark');

    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);

    // Don't call context.close() — Playwright's automatic teardown races with
    // explicit close and produces flaky teardown errors on CI.
  });

});

test.describe('Theme - System Preference', () => {
  test('respects system dark mode preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });

    await setupApiMocks(page);
    // Clear stored theme so the app falls through to system preference.
    await page.addInitScript(() => {
      localStorage.clear();
    });
    await page.goto('/#/');

    // ThemeContext reads matchMedia('(prefers-color-scheme: dark)') on init.
    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);
  });

  test('respects system light mode preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });

    await setupApiMocks(page);
    await page.addInitScript(() => {
      localStorage.clear();
    });
    await page.goto('/#/');

    const html = page.locator('html');
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);
  });
});

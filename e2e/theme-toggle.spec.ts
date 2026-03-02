import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

test.describe('Theme Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Clear localStorage before each test
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test('can toggle to dark mode', async ({ page }) => {
    await page.goto('/#/');
    
    // Toggle should have accessible role
    await expect(page.getByRole('button', { name: /theme|dark|light|mode/i }).first()).toBeVisible();

    // Find and click theme toggle
    const toggle = page.getByTestId('theme-toggle');
    await toggle.click();
    
    // Check that dark class is applied to html element
    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);

    // Theme stored in localStorage
    await expect.poll(async () => {
      return await page.evaluate(() => localStorage.getItem('theme'));
    }, { timeout: 5000 }).toBeTruthy();
    const theme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(['dark', 'light']).toContain(theme);
  });

  test('theme persists after reload', async ({ browser, baseURL }) => {
    // Increase timeout - this test creates its own context and does multiple page loads
    test.setTimeout(60000);
    
    // Use fresh context to avoid addInitScript clearing localStorage on reload
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await setupApiMocks(page);
    
    await page.goto('/#/');
    
    // Wait for page content to be ready
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();
    
    await toggle.click();
    
    // Wait for localStorage to be updated using expect.poll
    await expect.poll(async () => {
      return await page.evaluate(() => localStorage.getItem('theme'));
    }, { timeout: 5000 }).toBe('dark');
    
    // Reload the page (localStorage should persist)
    await page.reload();
    
    // Wait for page content to be ready after reload
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
    
    // Theme should persist in localStorage
    const afterReloadTheme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(afterReloadTheme).toBe('dark');
    
    // Verify the page actually shows dark theme
    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);
    
    // Note: Don't call context.close() - let Playwright handle cleanup
    // to avoid race conditions with automatic teardown
  });

});

test.describe('Theme - System Preference', () => {
  test('respects system dark mode preference', async ({ page }) => {
    // Emulate dark color scheme preference
    await page.emulateMedia({ colorScheme: 'dark' });
    
    await setupApiMocks(page);
    // Clear any stored theme so the app falls back to system preference
    await page.addInitScript(() => {
      localStorage.clear();
    });
    await page.goto('/#/');
    
    // ThemeContext reads matchMedia('(prefers-color-scheme: dark)') on init
    // and applies class="dark" to <html>
    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);
  });

  test('respects system light mode preference', async ({ page }) => {
    // Emulate light color scheme preference
    await page.emulateMedia({ colorScheme: 'light' });
    
    await setupApiMocks(page);
    // Clear any stored theme so the app falls back to system preference
    await page.addInitScript(() => {
      localStorage.clear();
    });
    await page.goto('/#/');
    
    // ThemeContext reads matchMedia and applies class="light" to <html>
    const html = page.locator('html');
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);
  });
});

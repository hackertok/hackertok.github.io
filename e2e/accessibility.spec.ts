import type { AxeResults } from 'axe-core';
import { test, expect } from './fixtures/test';
import { setupApiMocks } from './fixtures/api-mocks';

/** Attach axe incomplete results to the Playwright test report for manual review */
function attachIncomplete(results: AxeResults) {
  if (results.incomplete.length > 0) {
    test.info().annotations.push({
      type: 'axe-incomplete',
      description: results.incomplete.map(i => `${i.id} (${i.nodes.length} node(s))`).join(', '),
    });
  }
}

test.describe('Accessibility', () => {
  // Increase timeout for accessibility scans - axe-core can be slow
  test.setTimeout(60000);
  
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('homepage has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/');
    
    // Wait for content to load
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);
    
    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    
    expect(seriousViolations).toEqual([]);
  });

  test('item detail page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/item/12345');
    
    // Wait for content to load
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);
    
    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    
    expect(seriousViolations).toEqual([]);
  });

  test('theme toggle is keyboard accessible', async ({ page }) => {
    await page.goto('/#/');
    
    // Tab to theme toggle
    const themeToggle = page.getByTestId('theme-toggle');
    await themeToggle.focus();
    
    // Verify it has focus
    await expect(themeToggle).toBeFocused();
    
    // Activate with Enter key
    await page.keyboard.press('Enter');
    
    // Verify theme changed
    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);
  });

  test('navigation is keyboard accessible', async ({ page, browserName }) => {
    // Mobile browsers don't support Tab-key focus navigation
    test.skip(browserName === 'webkit', 'Tab navigation not supported on mobile webkit');

    await page.goto('/#/');
    
    // Wait for page to load
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    const interactiveTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
    
    // First Tab should land on an interactive element
    await page.keyboard.press('Tab');
    const firstTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(interactiveTags).toContain(firstTag);

    // Second Tab should move focus to a different interactive element
    const firstIdentity = await page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('href'));
    await page.keyboard.press('Tab');
    const secondTag = await page.evaluate(() => document.activeElement?.tagName);
    const secondIdentity = await page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('href'));
    expect(interactiveTags).toContain(secondTag);
    expect(secondIdentity).not.toEqual(firstIdentity);
  });

  test('external links have valid URLs', async ({ page }) => {
    await page.goto('/#/');
    
    // External item links should exist and be valid
    const externalLink = page.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
    await expect(externalLink).toBeVisible();
    
    // Verify the href points to external URL
    const href = await externalLink.getAttribute('href');
    expect(href).toContain('https://example.com');
  });

  test('best stories page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/best');
    
    await expect(page.getByText('The Art of Finishing Projects')).toBeVisible({ timeout: 10000 });
    // Active nav pill renders bg-accent text-accent-foreground — exercises accent contrast
    await expect(page.getByRole('link', { name: 'best', exact: true })).toBeVisible();
    
    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);
    
    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    
    expect(seriousViolations).toEqual([]);
  });

  test('domain filter page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/from/example.com');
    
    // Wait for domain-filtered content to load
    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).toBeVisible({ timeout: 10000 });
    
    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);
    
    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    
    expect(seriousViolations).toEqual([]);
  });
});

test.describe('Accessibility - Dark Mode', () => {
  // Increase timeout for accessibility scans
  test.setTimeout(60000);
  
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Set dark mode preference before navigation so ThemeContext reads it on mount
    await page.emulateMedia({ colorScheme: 'dark' });
  });

  test('dark mode has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/');
    
    // Wait for content to load
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    
    // Verify dark mode is actually active
    await expect(page.locator('html')).toHaveClass(/dark/);
    
    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);
    
    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    
    expect(seriousViolations).toEqual([]);
  });

  test('dark mode item detail has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/item/12345');
    
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dark/);
    
    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);
    
    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    
    expect(seriousViolations).toEqual([]);
  });
});

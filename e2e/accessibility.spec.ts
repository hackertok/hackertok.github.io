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
    // Wait for comments so axe scans .comment-content links (text-accent contrast)
    await expect(page.getByRole('link', { name: 'wasm-bindgen' }).first()).toBeVisible();
    
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

  test('user profile page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/user/pg');

    // Wait for the profile to render — covers the username heading, karma /
    // age meta row, submissions metadata link, and sanitized about text.
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'submissions' })).toBeVisible();

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);
  });

  test('user submissions page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/submitted/pg');

    // Wait for the submissions list to render so axe scans the StoryCard
    // byline links (font-medium / accent-hover contrast) for this route.
    await expect(page.getByText('Beating the Averages')).toBeVisible({ timeout: 10000 });

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
    // Wait for comments so axe scans .comment-content links (text-accent contrast)
    await expect(page.getByRole('link', { name: 'wasm-bindgen' }).first()).toBeVisible();
    
    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);
    
    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    
    expect(seriousViolations).toEqual([]);
  });

  test('dark mode user profile page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/user/pg');

    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dark/);
    // Meta row renders in dark mode, including the submissions link that is
    // distinguished by font weight rather than a standalone button style.
    await expect(page.getByRole('link', { name: 'submissions' })).toBeVisible();

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);
  });

  test('dark mode user submissions page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/submitted/pg');

    await expect(page.getByText('Beating the Averages')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('html')).toHaveClass(/dark/);

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);
  });
});

test.describe('Accessibility - Network Status Bar', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('offline status bar has no critical accessibility violations (light mode)', async ({ page, context, makeAxeBuilder }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Go offline to trigger the network status bar
    await context.setOffline(true);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(seriousViolations).toEqual([]);
  });

  test('offline status bar has no critical accessibility violations (dark mode)', async ({ page, context, makeAxeBuilder }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await context.setOffline(true);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(seriousViolations).toEqual([]);
  });
});

test.describe('Accessibility - prefers-reduced-motion', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('disables network status bar animations when reduced motion is preferred', async ({ page, context }) => {
    // Emulate prefers-reduced-motion: reduce
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Go offline to trigger the network status bar
    await context.setOffline(true);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    // The bar should have animation: none (not the slide-up keyframe)
    const barAnimation = await page.evaluate(() => {
      const bar = document.querySelector('.network-status-bar');
      return bar ? getComputedStyle(bar).animationName : null;
    });
    expect(barAnimation).toBe('none');
  });

  test('disables StateView scene animations when reduced motion is preferred', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Navigate to a non-existent item to trigger StateView with animated scene
    await page.goto('/#/item/99999999');
    await expect(page.getByText(/not found/i)).toBeVisible();

    // The .sv-scene and its children should have animation-iteration-count: 1
    const sceneAnimation = await page.evaluate(() => {
      const scene = document.querySelector('.sv-scene');
      if (!scene) return null;
      const style = getComputedStyle(scene);
      return { iterationCount: style.animationIterationCount };
    });
    expect(sceneAnimation).toBeTruthy();
    expect(sceneAnimation!.iterationCount).toBe('1');
  });
});

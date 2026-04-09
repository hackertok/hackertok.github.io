import { test, expect } from '@playwright/test';
import { test as fixtureTest } from './fixtures/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { smoothScrollAndAwaitSettled } from './fixtures/swipe-helpers';

test.describe('Network Status Bar - Viewport Switch', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('no horizontal overflow when going offline on desktop then switching to mobile', async ({ page, context }) => {
    // Load homepage on desktop
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Navigate to item detail
    await page.getByText('137 comments').first().click();
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Go offline — triggers the "No internet connection" bar
    await context.setOffline(true);
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    // Switch to mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Network bar still visible
    await expect(page.getByText('No internet connection')).toBeVisible();

    // No horizontal overflow — document width must not exceed viewport
    const { docWidth, vpWidth, barWidth, barBottom, vpHeight } = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      vpWidth: window.innerWidth,
      barWidth: document.querySelector('.network-status-bar')?.scrollWidth ?? 0,
      barBottom: document.querySelector('.network-status-bar')?.getBoundingClientRect().bottom ?? 0,
      vpHeight: window.innerHeight,
    }));

    expect(docWidth).toBeLessThanOrEqual(vpWidth);
    expect(barWidth).toBeLessThanOrEqual(vpWidth);
    // Bar should be at the viewport bottom
    expect(barBottom).toBeGreaterThanOrEqual(vpHeight - 2);
    expect(barBottom).toBeLessThanOrEqual(vpHeight + 2);
  });

  test('no horizontal overflow after desktop-to-mobile offline then swiping', async ({ page, context }) => {
    // Start on DESKTOP, load homepage
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Go offline on desktop
    await context.setOffline(true);
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    // Switch to mobile viewport — triggers swipe mode
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Wait for swipe container to render
    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible({ timeout: 5000 });
    await page.waitForFunction(() => {
      const panels = document.querySelectorAll('[data-testid="swipe-panel"]');
      return panels.length >= 2;
    }, { timeout: 5000 });

    // Verify overflow is clipped: html element has overflow: clip in swipe mode
    const overflowState = await page.evaluate(() => ({
      htmlOx: getComputedStyle(document.documentElement).overflowX,
      bodyOx: getComputedStyle(document.body).overflowX,
      mainOx: getComputedStyle(document.querySelector('main')!).overflowX,
    }));
    expect(overflowState.htmlOx).toBe('clip');
    expect(overflowState.bodyOx).toBe('hidden');
    expect(overflowState.mainOx).toBe('clip');

    // Viewport should not be horizontally scrollable
    await page.evaluate(() => window.scrollTo(9999, 0));
    const scrollAfterAttempt = await page.evaluate(() => window.scrollX);
    expect(scrollAfterAttempt).toBe(0);

    // Swipe to next story
    const vpWidth = page.viewportSize()!.width;
    await smoothScrollAndAwaitSettled(container, vpWidth);
    await page.waitForTimeout(300);

    // After swipe: page should still not be horizontally scrollable
    await page.evaluate(() => window.scrollTo(9999, 0));
    const scrollAfterSwipe = await page.evaluate(() => window.scrollX);
    expect(scrollAfterSwipe).toBe(0);

    // Network bar should still be within viewport bounds
    const barRect = await page.evaluate(() => {
      const bar = document.querySelector('.network-status-bar');
      if (!bar) return null;
      const rect = bar.getBoundingClientRect();
      return { width: rect.width, left: rect.left, right: rect.right };
    });
    expect(barRect).toBeTruthy();
    expect(barRect!.width).toBeLessThanOrEqual(vpWidth);
    expect(barRect!.left).toBeGreaterThanOrEqual(0);
    expect(barRect!.right).toBeLessThanOrEqual(vpWidth);

    // Swipe back and verify again
    await smoothScrollAndAwaitSettled(container, 0);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(9999, 0));
    const scrollAfterSwipeBack = await page.evaluate(() => window.scrollX);
    expect(scrollAfterSwipeBack).toBe(0);
  });
});

fixtureTest.describe('Network Status Bar - Offline Item Detail to Mobile', () => {
  fixtureTest.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  fixtureTest.setTimeout(60000);

  fixtureTest('no layout overflow when viewing failed item then switching to mobile', async ({ page, context }) => {
    // Load homepage on desktop with working APIs
    await setupApiMocks(page);
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Go offline — subsequent fetches will fail + bar appears
    await context.setOffline(true);
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    // Navigate to item comments (fetch will fail since offline)
    await page.getByText('137 comments').first().click();
    await page.waitForTimeout(1000);

    // Switch to mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // No horizontal overflow
    const { docWidth, vpWidth } = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      vpWidth: window.innerWidth,
    }));
    expect(docWidth).toBeLessThanOrEqual(vpWidth);
  });
});

test.describe('Swipe viewer - offline end-of-feed behavior', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('hides loading/error panels at end of feed when offline', async ({ page, context }) => {
    // Load stories on mobile (swipe mode)
    await page.goto('/#/');
    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();

    // Wait for stories to render and stabilize
    await page.waitForFunction(() => {
      const panels = document.querySelectorAll('[data-testid="swipe-panel"]');
      return panels.length >= 2;
    }, { timeout: 5000 });
    // Let the feed fully settle (auto-loads more pages when stories < 10)
    await page.waitForLoadState('networkidle');

    // Go offline
    await context.setOffline(true);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });

    // Network bar should appear
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    // Count panels after going offline — this is our baseline
    const panelCount = await page.locator('[data-testid="swipe-panel"]').count();

    // Swipe to the very last story panel
    const vpWidth = page.viewportSize()!.width;
    for (let i = 1; i < panelCount; i++) {
      await smoothScrollAndAwaitSettled(container, vpWidth * i);
    }

    // Wait for any potential loading/error panels to appear
    await page.waitForTimeout(1000);

    // No loading panel should exist — offline hides it
    await expect(page.getByTestId('swipe-panel-loading')).toHaveCount(0);

    // No extra panels were appended (no error panel at the end)
    const panelCountAfterSwipe = await page.locator('[data-testid="swipe-panel"]').count();
    expect(panelCountAfterSwipe).toBe(panelCount);

    // Document title should reflect the last story, not "Failed to load item"
    const title = await page.title();
    expect(title).not.toContain('Failed to load');
  });
});

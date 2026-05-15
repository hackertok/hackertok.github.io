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
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await page.getByText('137 comments').first().evaluate(el => (el as HTMLElement).click());
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    await expect(page.getByText('No internet connection')).toBeVisible();

    const { docWidth, vpWidth, barWidth, barBottom, vpHeight } = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      vpWidth: window.innerWidth,
      barWidth: document.querySelector('.network-status-bar')?.scrollWidth ?? 0,
      barBottom: document.querySelector('.network-status-bar')?.getBoundingClientRect().bottom ?? 0,
      vpHeight: window.innerHeight,
    }));

    expect(docWidth).toBeLessThanOrEqual(vpWidth);
    expect(barWidth).toBeLessThanOrEqual(vpWidth);
    // ±2px tolerance for sub-pixel layout: bar must visually pin to viewport bottom.
    expect(barBottom).toBeGreaterThanOrEqual(vpHeight - 2);
    expect(barBottom).toBeLessThanOrEqual(vpHeight + 2);
  });

  test('no horizontal overflow after desktop-to-mobile offline then swiping', async ({ page, context }) => {
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    // Resize triggers swipe mode via the breakpoint hook.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible({ timeout: 5000 });
    await page.waitForFunction(() => {
      const panels = document.querySelectorAll('[data-testid="swipe-panel"]');
      return panels.length >= 2;
    }, { timeout: 5000 });

    // Swipe mode must clip overflow on every level — html/body/main all
    // need their own overflow declaration; missing any one of these
    // surfaces as horizontal scroll on iOS Safari.
    const overflowState = await page.evaluate(() => ({
      htmlOx: getComputedStyle(document.documentElement).overflowX,
      bodyOx: getComputedStyle(document.body).overflowX,
      mainOx: getComputedStyle(document.querySelector('main')!).overflowX,
    }));
    expect(overflowState.htmlOx).toBe('clip');
    expect(overflowState.bodyOx).toBe('hidden');
    expect(overflowState.mainOx).toBe('clip');

    // Active assertion: scrolling to 9999 must be clamped to 0.
    await page.evaluate(() => window.scrollTo(9999, 0));
    const scrollAfterAttempt = await page.evaluate(() => window.scrollX);
    expect(scrollAfterAttempt).toBe(0);

    const vpWidth = page.viewportSize()!.width;
    await smoothScrollAndAwaitSettled(container, vpWidth);
    await page.waitForTimeout(300);

    await page.evaluate(() => window.scrollTo(9999, 0));
    const scrollAfterSwipe = await page.evaluate(() => window.scrollX);
    expect(scrollAfterSwipe).toBe(0);

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
    await setupApiMocks(page);
    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    // Subsequent fetches will fail; the offline bar must appear before navigation.
    await context.setOffline(true);
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    // Click triggers a fetch that will fail under offline state.
    await page.getByText('137 comments').first().evaluate(el => (el as HTMLElement).click());
    await page.waitForTimeout(1000);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

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
    await page.goto('/#/');
    const container = page.getByTestId('swipe-container');
    await expect(container).toBeVisible();

    await page.waitForFunction(() => {
      const panels = document.querySelectorAll('[data-testid="swipe-panel"]');
      return panels.length >= 2;
    }, { timeout: 5000 });
    // networkidle waits for auto-loads (the feed fetches more pages when < 10 stories).
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });

    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    // Baseline panel count BEFORE swiping — the contract is "no panels added".
    const panelCount = await page.locator('[data-testid="swipe-panel"]').count();

    const vpWidth = page.viewportSize()!.width;
    for (let i = 1; i < panelCount; i++) {
      await smoothScrollAndAwaitSettled(container, vpWidth * i);
    }

    await page.waitForTimeout(1000);

    // Offline must suppress the loading panel — otherwise the user sees a
    // perpetual spinner that can't resolve.
    await expect(page.getByTestId('swipe-panel-loading')).toHaveCount(0);

    // Same panel count = no error panel was appended at the tail.
    const panelCountAfterSwipe = await page.locator('[data-testid="swipe-panel"]').count();
    expect(panelCountAfterSwipe).toBe(panelCount);

    const title = await page.title();
    expect(title).not.toContain('Failed to load');
  });
});

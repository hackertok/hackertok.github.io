import { test, expect } from '@playwright/test';
import { test as fixtureTest } from './fixtures/test';
import { setupApiMocks } from './fixtures/api-mocks';
import { smoothScrollAndAwaitSettled } from './fixtures/swipe-helpers';
import {
  expectLocatorCenteredBetweenChrome,
  setOfflineAndWaitForBar,
} from './fixtures/layout-helpers';

test.describe('Network Status Bar - Viewport Switch', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Pre-load lazy-loaded mobile chunks (SwipeStoryViewer, etc.) while still
    // online. Without this, resizing to mobile viewport while offline causes a
    // dynamic import failure that triggers the Error Boundary instead of the
    // network status bar.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');
    await page.setViewportSize({ width: 1280, height: 720 });
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

    // Swipe mode must clip overflow on html/body to prevent horizontal scroll.
    const overflowState = await page.evaluate(() => ({
      htmlOx: getComputedStyle(document.documentElement).overflowX,
      bodyOx: getComputedStyle(document.body).overflowX,
    }));
    expect(overflowState.htmlOx).toBe('clip');
    expect(overflowState.bodyOx).toBe('hidden');

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

test.describe('Network Status Bar - Centered state layouts', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('keeps the full-page not-found state centered with the offline bar visible', async ({ page, context }) => {
    await page.goto('/#/missing-route');

    const stateRoot = page.getByRole('heading', {
      name: 'Lost in the feed',
    }).locator('xpath=..');
    await expect(stateRoot).toBeVisible();

    await setOfflineAndWaitForBar(page, context);
    await expectLocatorCenteredBetweenChrome(stateRoot);
  });
});

test.describe('Network Status Bar - Mobile content spacing', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('keeps the story title gap stable when the offline bar appears', async ({ page, context }) => {
    await page.goto('/#/item/12345');

    const title = page.getByRole('heading', { level: 1 }).first();
    await expect(title).toBeVisible();
    await page.waitForFunction(() => {
      const heading = document.querySelector('h1');
      const stage = heading?.closest('.page-stage');
      return !!stage
        && stage.classList.contains('fade-skeleton')
        && !stage.classList.contains('play-real');
    });

    const beforeGap = await page.evaluate(() => {
      const heading = document.querySelector('h1');
      const header = document.querySelector('header');
      if (!(heading instanceof HTMLElement) || !(header instanceof HTMLElement)) return null;
      return heading.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    });

    expect(beforeGap).not.toBeNull();

    await setOfflineAndWaitForBar(page, context);

    const afterMetrics = await page.evaluate(() => {
      const heading = document.querySelector('h1');
      const header = document.querySelector('header');
      const panel = document.querySelector('[data-testid="swipe-panel"].active') ?? document.querySelector('[data-testid="swipe-panel"]');
      if (!(heading instanceof HTMLElement) || !(header instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
        return null;
      }

      return {
        gap: heading.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
        paddingTop: getComputedStyle(panel).paddingTop,
        paddingBottom: getComputedStyle(panel).paddingBottom,
      };
    });

    expect(afterMetrics).not.toBeNull();
    expect(afterMetrics?.paddingTop).toBe('53px');
    expect(afterMetrics?.paddingBottom).toBe('32px');
    expect(Math.abs((afterMetrics?.gap ?? 0) - (beforeGap ?? 0))).toBeLessThanOrEqual(2);
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

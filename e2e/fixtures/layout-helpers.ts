import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

interface CenteredBetweenChromeOptions {
  tolerance?: number;
  topSelector?: string;
  bottomSelector?: string;
}

/**
 * Approximate a raised default font size by moving the root font size that every
 * `rem` resolves against. Only an approximation: `rem` in a media query resolves
 * against the browser's *initial* size, which no stylesheet can reach, so the
 * breakpoints stay put. layout-tokens.spec.ts covers that half over CDP.
 */
export async function enlargeRootFont(page: Page, px: number) {
  await page.addInitScript((size) => {
    const apply = () => {
      const style = document.createElement('style');
      style.textContent = `html{font-size:${size}px}`;
      document.head.appendChild(style);
    };
    if (document.head) apply();
    else document.addEventListener('DOMContentLoaded', apply);
  }, px);
}

/**
 * Emulate the browser's own default font size — the setting itself, so `rem`
 * media queries move with it, which {@link enlargeRootFont} cannot reach.
 * Chromium only; skip the calling test elsewhere.
 */
export async function emulateBrowserFontSize(page: Page, px: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: px, fixed: px } });
}

/**
 * Emulate Android's text scaling, which is neither of the above: it inflates
 * glyphs and leaves every `rem` length — padding, gaps, icons — where it was.
 * Applied after load on purpose, so a nav that only re-packs when its own box
 * changes size fails this; the text growing inside it has to be enough.
 */
export async function scaleNavTextOnly(page: Page, factor: number) {
  await page.evaluate((size) => {
    const style = document.createElement('style');
    // `text-sm` is 14px at a 16px root.
    style.textContent = `header nav a, header nav span, header nav button { font-size: ${size}px !important; }`;
    document.head.appendChild(style);
  }, 14 * factor);
}

/**
 * Force the app into its offline-bar state after the route has already loaded.
 * This lets geometry assertions include the fixed bottom chrome without making
 * the page's initial data fetch nondeterministic.
 */
export async function setOfflineAndWaitForBar(page: Page, context: BrowserContext) {
  await context.setOffline(true);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('offline'));
  });

  await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

  await page.waitForFunction(() => {
    const bar = document.querySelector('.network-status-bar');
    if (!bar) return false;

    const rect = bar.getBoundingClientRect();
    return Math.abs(rect.bottom - window.innerHeight) <= 2;
  }, { timeout: 5000 });
}

/**
 * Assert that a chrome height token describes the element it claims to measure.
 *
 * `getComputedStyle` returns the literal `calc(…)` text for a custom property,
 * so a probe element hands the expression back to the engine to be measured.
 */
export async function expectChromeTokenToMatch(
  page: Page,
  token: string,
  selector: string,
  { tolerance = 0.5 }: { tolerance?: number } = {},
) {
  // Poll: every engine can report a header mid-reflow for a frame or two after
  // the root font size changes. A token that genuinely disagrees never converges.
  await expect
    .poll(
      async () => {
        const { declared, rendered } = await page.evaluate(
          ({ token, selector }) => {
            const probe = document.createElement('div');
            probe.style.cssText =
              `position:absolute;top:0;left:0;width:1px;visibility:hidden;height:var(${token})`;
            document.body.appendChild(probe);
            const declared = probe.getBoundingClientRect().height;
            probe.remove();

            const el = document.querySelector(selector);
            return { declared, rendered: el?.getBoundingClientRect().height ?? -1 };
          },
          { token, selector },
        );

        if (rendered <= 0) return `${selector} is not rendered`;
        return Math.abs(declared - rendered) <= tolerance
          ? 'match'
          : `${token} resolves to ${declared}px but ${selector} renders ${rendered}px`;
      },
      { message: `${token} should describe ${selector}` },
    )
    .toBe('match');
}

/**
 * Assert that a block is centered in the usable viewport between the fixed
 * header and the optional fixed bottom bar.
 */
export async function expectLocatorCenteredBetweenChrome(
  locator: Locator,
  {
    tolerance = 8,
    topSelector = 'header',
    bottomSelector = '.network-status-bar',
  }: CenteredBetweenChromeOptions = {},
) {
  await expect(locator).toBeVisible();

  const geometry = await locator.evaluate((el, selectors) => {
    const childRects = Array.from(el.children)
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);

    const rect = childRects.length > 0
      ? childRects.reduce(
        (bounds, childRect) => ({
          top: Math.min(bounds.top, childRect.top),
          right: Math.max(bounds.right, childRect.right),
          bottom: Math.max(bounds.bottom, childRect.bottom),
          left: Math.min(bounds.left, childRect.left),
        }),
        {
          top: childRects[0].top,
          right: childRects[0].right,
          bottom: childRects[0].bottom,
          left: childRects[0].left,
        },
      )
      : el.getBoundingClientRect();

    const topBoundary = document.querySelector(selectors.topSelector)?.getBoundingClientRect().bottom ?? 0;
    const bottomBoundary = document.querySelector(selectors.bottomSelector)?.getBoundingClientRect().top ?? window.innerHeight;
    const expectedCenterX = window.innerWidth / 2;
    const expectedCenterY = topBoundary + ((bottomBoundary - topBoundary) / 2);
    const width = 'width' in rect ? rect.width : rect.right - rect.left;
    const height = 'height' in rect ? rect.height : rect.bottom - rect.top;
    const centerX = rect.left + (width / 2);
    const centerY = rect.top + (height / 2);

    return {
      deltaX: Math.abs(centerX - expectedCenterX),
      deltaY: Math.abs(centerY - expectedCenterY),
    };
  }, { topSelector, bottomSelector });

  expect(geometry.deltaX).toBeLessThanOrEqual(tolerance);
  expect(geometry.deltaY).toBeLessThanOrEqual(tolerance);
}
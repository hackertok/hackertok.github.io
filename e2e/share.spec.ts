import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

// The share control is the app's only route for lifting an item's URL out of
// the feed, and the reason the story headline no longer raises the iOS
// long-press callout. It renders through ItemArticle, which both the desktop
// detail page and the mobile swipe panel mount, so both surfaces are checked.
//
// Neither Web Share nor the clipboard can be driven for real here: the share
// sheet is OS chrome Playwright cannot see, and clipboard access needs
// per-browser permission grants. Both APIs are therefore installed as recorders
// before the app boots, which is also the only way to assert the exact payload.

const ITEM_ID = 12345;

declare global {
  interface Window {
    __sharePayloads?: { title?: string; url?: string }[];
    __clipboardWrites?: string[];
  }
}

/** Install a recording `navigator.share`, as a platform that has a share sheet. */
async function recordShares(page: Page) {
  await page.addInitScript(() => {
    window.__sharePayloads = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: { title?: string; url?: string }) => {
        window.__sharePayloads!.push(data);
        return Promise.resolve();
      },
    });
  });
}

/**
 * Present a platform with no share sheet but a working clipboard, which is what
 * desktop Firefox actually is.
 */
async function recordClipboardOnly(page: Page) {
  await page.addInitScript(() => {
    window.__clipboardWrites = [];
    // WebKit ships a real `navigator.share` on the prototype, so deleting an own
    // property leaves it in place — it has to be shadowed instead.
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          window.__clipboardWrites!.push(text);
          return Promise.resolve();
        },
      },
    });
  });
}

const shareButton = (page: Page) => page.getByRole('button', { name: 'Share' });

test.describe('Share control', () => {
  test.describe('desktop detail page', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('shares this app\'s link to the item', async ({ page }) => {
      await recordShares(page);
      await setupApiMocks(page);
      await page.goto(`/#/item/${ITEM_ID}`);

      await shareButton(page).click();

      const payloads = await page.evaluate(() => window.__sharePayloads);
      expect(payloads).toHaveLength(1);
      expect(payloads![0].url).toBe(`${new URL(page.url()).origin}/#/item/${ITEM_ID}`);
      // A bare URL in a share sheet gives the recipient no context, so the
      // headline travels with it.
      expect(payloads![0].title).toBeTruthy();
    });

    test('copies the link and says so where there is no share sheet', async ({ page }) => {
      await recordClipboardOnly(page);
      await setupApiMocks(page);
      await page.goto(`/#/item/${ITEM_ID}`);

      await shareButton(page).click();

      const writes = await page.evaluate(() => window.__clipboardWrites);
      expect(writes).toEqual([`${new URL(page.url()).origin}/#/item/${ITEM_ID}`]);
      // The sheet would have confirmed itself; a silent copy has to be announced.
      await expect(page.getByRole('status').first()).toHaveText('Link copied to clipboard');
    });
  });

  test.describe('mobile swipe panel', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('shares from inside the swipe viewer', async ({ page }) => {
      await recordShares(page);
      await setupApiMocks(page);
      await page.goto(`/#/item/${ITEM_ID}`);

      await shareButton(page).click();

      const payloads = await page.evaluate(() => window.__sharePayloads);
      expect(payloads).toHaveLength(1);
      expect(payloads![0].url).toBe(`${new URL(page.url()).origin}/#/item/${ITEM_ID}`);
    });
  });

  test.describe('platforms with neither route', () => {
    test('renders no control at all rather than a dead one', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      });
      await setupApiMocks(page);
      await page.goto(`/#/item/${ITEM_ID}`);

      // Anchor on the article having rendered, so this can't pass just because
      // the page never loaded. Scoped to the first match because the swipe
      // viewer keeps inactive panels in the DOM behind `display: none`.
      await expect(page.locator('article h1').first()).toBeVisible();
      await expect(shareButton(page)).toHaveCount(0);
    });
  });
});

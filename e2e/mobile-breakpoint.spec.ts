import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import {
  emulateBrowserFontSize,
  enlargeRootFont,
  setOfflineAndWaitForBar,
} from './fixtures/layout-helpers';
import { waitForSwipeReady } from './fixtures/swipe-helpers';

// Two questions live here, and they used to be one.
//
// `useIsMobileLayout` is shape: how much chrome fits, asked in `md:`'s own
// 48rem so the answer cannot disagree with the styles around it. It used to ask
// 767px, which only equals 48rem at a 16px root.
//
// `useCanSwipe` is which tree mounts, and it wants a finger as well, because
// the swipe viewer binds touch and nothing else — no keys, no wheel, no
// buttons. Width alone put mouse readers in it: by a narrowed window, or by a
// default font size large enough to make 48rem wider than their screen.
//
// The tree is read off the URL: the swipe viewer rewrites `/` to the story it
// lands on, and the list leaves it alone.

const TOP_STORY_TITLE = 'Rust Is the Future of JavaScript Infrastructure';
// The viewer rewrites `/` to the story it lands on; the list leaves it alone.
const ITEM_URL = /\/#\/item\/\d+/;

const reservation = (page: Page) =>
  page.evaluate(() => ({
    main: getComputedStyle(document.querySelector('main')!).paddingBottom,
    panel: getComputedStyle(
      document.querySelector('.swipe-snap-panel.active') ?? document.body,
    ).paddingBottom,
    bar: getComputedStyle(document.documentElement)
      .getPropertyValue('--network-bar-height')
      .trim(),
  }));

const mdMatches = (page: Page) =>
  page.evaluate(() => ({
    md: matchMedia('(min-width: 48rem)').matches,
    px: matchMedia('(min-width: 768px)').matches,
  }));

test.describe('A 900px viewport at a 24px default font — with a finger', () => {
  test.use({ viewport: { width: 900, height: 800 }, hasTouch: true });

  test('is mobile on both counts, and mounts the viewer', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'only Chromium can emulate the setting');
    await emulateBrowserFontSize(page, 24);
    await setupApiMocks(page);
    await page.goto('/#/');

    // Without this window there is nothing for the assertion below to catch:
    // 48rem is 1152px here, so only the old px query would have said desktop.
    expect(
      await mdMatches(page),
      'this viewport no longer sits between the rem and px md breakpoints',
    ).toEqual({ md: false, px: true });

    await page.waitForURL(ITEM_URL, { timeout: 10_000 });
    await waitForSwipeReady(page);
  });

  test('reserves the bar inside its panels, not around the flow', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'only Chromium can emulate the setting');
    await emulateBrowserFontSize(page, 24);
    await setupApiMocks(page);
    await page.goto('/#/');
    await page.waitForURL(ITEM_URL, { timeout: 10_000 });
    // `--network-bar-height` is 0 until the bar is up, so nothing below this
    // line would mean anything without it.
    await setOfflineAndWaitForBar(page, context);

    // Padding the flow as well would strand an empty strip under a feed that
    // has already made room inside the panel the reader is on.
    const { main, panel, bar } = await reservation(page);
    expect(bar).not.toBe('0px');
    expect(panel).toBe(bar);
    expect(main).toBe('0px');
  });
});

test.describe('A 900px viewport at a 24px default font — with a mouse', () => {
  test.use({ viewport: { width: 900, height: 800 } });
  // A phone project's finger is baked in at the project level, and this is the
  // other device class — the one width alone used to misfile.
  test.skip(({ hasTouch }) => hasTouch, 'needs a pointer that can hover');

  test('gets the mobile header and the list it can actually drive', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'only Chromium can emulate the setting');
    await emulateBrowserFontSize(page, 24);
    await setupApiMocks(page);
    await page.goto('/#/');

    // Same side of the line as the test above — this is the reader #249 would
    // otherwise have handed a viewer with no way forward: a low-vision desktop
    // reader on a large default font, whose 900px window is under 48rem.
    expect(await mdMatches(page)).toEqual({ md: false, px: true });

    // Shape followed the width: `md:` reveals the pill icons, and it agrees.
    await expect(page.locator('header nav a svg').first()).not.toBeVisible();

    // The tree followed the pointer.
    await expect(page.getByTestId('swipe-container')).toHaveCount(0);
    expect(page.url()).not.toMatch(ITEM_URL);

    // And it goes somewhere, which was the whole complaint.
    await page.getByText('137 comments').first().click();
    await expect(page).toHaveURL(ITEM_URL);
    await expect(page.getByRole('link', { name: TOP_STORY_TITLE }).first()).toBeVisible();
  });

  test('keeps the strip the list would otherwise scroll under', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'only Chromium can emulate the setting');
    await emulateBrowserFontSize(page, 24);
    await setupApiMocks(page);
    await page.goto('/#/');
    await expect(page.getByRole('link', { name: TOP_STORY_TITLE }).first()).toBeVisible();
    await setOfflineAndWaitForBar(page, context);

    // Whoever answers this has to answer for the tree, not the width: a width
    // query skips a list mounted below `md:` and hides its last row behind the
    // bar, which is where this rule used to live.
    await expect
      .poll(async () => {
        const { main, bar } = await reservation(page);
        return { main, bar, reserved: bar !== '0px' && main === bar };
      })
      .toMatchObject({ reserved: true });
  });
});

test.describe('Where the rem line falls, either way', () => {
  test.use({ viewport: { width: 900, height: 800 } });

  test('a root font size set in CSS moves neither question', async ({ page }) => {
    // `rem` in a media query is the browser's default, not the root element,
    // so `html { font-size: 24px }` leaves `md:` where it was — and the hook
    // has to ignore it too, or it would draw mobile chrome in desktop styling.
    await enlargeRootFont(page, 24);
    await setupApiMocks(page);
    await page.goto('/#/');

    expect(
      await page.evaluate(() => ({
        root: getComputedStyle(document.documentElement).fontSize,
        md: matchMedia('(min-width: 48rem)').matches,
      })),
    ).toEqual({ root: '24px', md: true });

    await expect(page.getByRole('link', { name: TOP_STORY_TITLE }).first()).toBeVisible();
    expect(page.url()).not.toMatch(ITEM_URL);
  });

  test('a 12px default font puts a 620px viewport on the desktop side', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'only Chromium can emulate the setting');
    await emulateBrowserFontSize(page, 12);
    await setupApiMocks(page);
    await page.setViewportSize({ width: 620, height: 800 });
    await page.goto('/#/');

    // The mirror of the first: 48rem is 576px here, so the px query is the
    // one that would have said mobile.
    expect(
      await mdMatches(page),
      'this viewport no longer sits between the rem and px md breakpoints',
    ).toEqual({ md: true, px: false });

    await expect(page.getByRole('link', { name: TOP_STORY_TITLE }).first()).toBeVisible();
    expect(page.url()).not.toMatch(ITEM_URL);

    // And the header pays for what it draws: this is the band where `md:` put
    // an icon in every pill that the packer had reserved nothing for.
    await expect(page.locator('header nav a svg').first()).toBeVisible();
  });
});

// index.html guesses the tree before React exists, to keep the first paint from
// carrying the other layout's scrollbar. A guess in different terms than the
// hook's is a guess that can be wrong, so it asks both of the same questions —
// and these tests hold it to that by cutting the app's own scripts, leaving the
// inline one as the only thing that could have added the class.
test.describe('The first paint, before React', () => {
  test.describe('with a finger', () => {
    test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

    test('bets on swipe mode', async ({ page }) => {
      await page.route('**/*.js', route => route.abort());
      await page.goto('/#/', { waitUntil: 'domcontentloaded' });

      expect(
        await page.evaluate(() => document.documentElement.classList.contains('swipe-mode')),
      ).toBe(true);
    });
  });

  test.describe('with a finger, on a viewport only rem calls narrow', () => {
    test.use({ viewport: { width: 900, height: 800 }, hasTouch: true });

    test('bets on it there too', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'only Chromium can emulate the setting');
      await emulateBrowserFontSize(page, 24);
      await page.route('**/*.js', route => route.abort());
      await page.goto('/#/', { waitUntil: 'domcontentloaded' });

      // 48rem is 1152px at this setting, so `innerWidth < 768` said no here and
      // handed the viewer a first paint with the list's scrollbar in it.
      expect(
        await page.evaluate(() => document.documentElement.classList.contains('swipe-mode')),
      ).toBe(true);
    });
  });

  test.describe('with a mouse', () => {
    test.use({ viewport: { width: 375, height: 667 } });
    test.skip(({ hasTouch }) => hasTouch, 'needs a pointer that can hover');

    test('does not, however narrow the window', async ({ page }) => {
      await page.route('**/*.js', route => route.abort());
      await page.goto('/#/', { waitUntil: 'domcontentloaded' });

      // The old `innerWidth < 768` would have said yes here, then watched
      // React mount a list into styling written for the viewer.
      expect(
        await page.evaluate(() => document.documentElement.classList.contains('swipe-mode')),
      ).toBe(false);
    });
  });
});

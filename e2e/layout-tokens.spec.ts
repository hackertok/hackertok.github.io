import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks, stubNotFoundUser } from './fixtures/api-mocks';
import {
  enlargeRootFont,
  expectChromeTokenToMatch,
  setOfflineAndWaitForBar,
} from './fixtures/layout-helpers';

// `--header-height` and `--network-bar-height` duplicate, by hand, heights that
// Tailwind utilities produce on the components. Nothing in the build connects
// the two, and disagreement is silent: panels reserve space with the token, so
// one that under-reports leaves the header painting over every story.
//
// Both sizes matter at every breakpoint because the header's 2.25rem control row
// scales with the root font size, so a px token is only ever right at 16px.

/** 150% browser font setting: realistic, and unambiguously off the default. */
const ENLARGED_ROOT_PX = 24;

const BREAKPOINTS = [
  { label: 'base', width: 375, height: 667 },
  { label: 'md', width: 800, height: 800 },
  { label: 'lg', width: 1100, height: 800 },
  { label: 'xl', width: 1400, height: 900 },
];

/**
 * The theme toggle IS the control row that sets the header's height, so its paint
 * is the readiness signal. Fonts too: a face swap re-measures the whole bar.
 */
async function awaitHeaderPainted(page: Page) {
  await expect(page.getByTestId('theme-toggle')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const breakpoint of BREAKPOINTS) {
  test.describe(`--header-height at the ${breakpoint.label} breakpoint`, () => {
    test.use({ viewport: { width: breakpoint.width, height: breakpoint.height } });

    test.beforeEach(async ({ page }) => {
      await setupApiMocks(page);
    });

    test('matches the rendered header', async ({ page }) => {
      await page.goto('/#/');
      await awaitHeaderPainted(page);

      await expectChromeTokenToMatch(page, '--header-height', '.app-header');
    });

    test('still matches when the reader enlarges their default font size', async ({ page }) => {
      await enlargeRootFont(page, ENLARGED_ROOT_PX);
      await page.goto('/#/');
      await awaitHeaderPainted(page);

      // Guard the emulation: if the injected stylesheet stopped applying, the
      // assertion below would quietly re-test the default size.
      const rootFontSize = await page.evaluate(
        () => getComputedStyle(document.documentElement).fontSize,
      );
      expect(rootFontSize).toBe(`${ENLARGED_ROOT_PX}px`);

      await expectChromeTokenToMatch(page, '--header-height', '.app-header');
    });
  });
}

test.describe('breakpoint-driven layout under a real browser font setting', () => {
  // 900px sits where a `768px` query and Tailwind's `md:` disagree at a 24px
  // default font: 48rem becomes 1152px, so only a px query would have switched.
  test.use({ viewport: { width: 900, height: 800 } });

  const skipUnlessChromium = (browserName: string) =>
    test.skip(
      browserName !== 'chromium',
      'Only Chromium can emulate the browser default font size rather than the root font size',
    );

  const emulateDefaultFontSize = async (page: Page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', {
      fontSizes: { standard: ENLARGED_ROOT_PX, fixed: ENLARGED_ROOT_PX },
    });
  };

  test('--header-height changes on the same breakpoint as the padding it mirrors', async ({ page, browserName }) => {
    skipUnlessChromium(browserName);

    await setupApiMocks(page);
    await emulateDefaultFontSize(page);

    await page.goto('/#/');
    await awaitHeaderPainted(page);

    // Without this window there is nothing for the assertion below to catch.
    const inDisagreementWindow = await page.evaluate(
      () =>
        !window.matchMedia('(width >= 48rem)').matches &&
        window.matchMedia('(width >= 768px)').matches,
    );
    expect(
      inDisagreementWindow,
      'this viewport no longer sits between the rem and px md breakpoints',
    ).toBe(true);

    await expectChromeTokenToMatch(page, '--header-height', '.app-header');
  });

  test('a full-page state keeps the gutters of the container it replaces', async ({ page, browserName }) => {
    skipUnlessChromium(browserName);

    await setupApiMocks(page);
    await stubNotFoundUser(page, 'nope');
    await emulateDefaultFontSize(page);

    await page.goto('/#/user/nope');
    await expect(page.getByText('User not found')).toBeVisible();

    // The class stands in for the header's `px-4 md:px-8 lg:px-16 xl:px-24`
    // container, so misalignment is the visible symptom of drifted breakpoints.
    const gutters = await page.evaluate(() => {
      const paddingLeftOf = (selector: string) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el).paddingLeft : null;
      };
      return {
        state: paddingLeftOf('.page-state-center-padded'),
        container: paddingLeftOf('.app-header > div'),
      };
    });

    expect(gutters.state, 'the padded state should be on screen').not.toBeNull();
    expect(gutters.state).toBe(gutters.container);
  });
});

test.describe('--network-bar-height', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('matches the rendered offline bar', async ({ page, context }) => {
    await setupApiMocks(page);
    await page.goto('/#/');
    await awaitHeaderPainted(page);

    await setOfflineAndWaitForBar(page, context);

    // NetworkStatusBar writes this token from JS while the bar's own height
    // comes from CSS — two literals with nothing but this test between them.
    await expectChromeTokenToMatch(page, '--network-bar-height', '.network-status-bar');
  });
});

// The one place that paints the viewer's markup without the viewer: while it
// decides story-or-comment, the panel is on screen and pads for the header
// itself. React has to know that, or `<main>` reserves the header a second time
// and the skeleton starts a whole header below the story that replaces it.
test.describe('the chrome under a panel with no viewer yet', () => {
  test.use({ viewport: { width: 412, height: 839 }, hasTouch: true });

  test('is reserved once, by the panel', async ({ page }) => {
    await setupApiMocks(page);
    // Hold the type lookup open: the window is one round trip otherwise.
    await page.route('**/v0/item/12345.json*', async route => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      await route.fallback();
    });

    await page.goto('/#/item/12345');
    await expect(page.getByTestId('swipe-panel')).toBeVisible();

    const { contentTop, headerBottom } = await page.evaluate(() => {
      const panel = document.querySelector('.swipe-snap-panel.active')!;
      return {
        contentTop: panel.firstElementChild!.getBoundingClientRect().top,
        headerBottom: document.querySelector('.app-header')!.getBoundingClientRect().bottom,
      };
    });

    expect(contentTop).toBeCloseTo(headerBottom, 0);
  });
});

// The list tree's half of the same sum. `<main>` reserves both fixed bars for
// whatever page is below it, and each reservation is the token the panels use —
// not a second number that lands near it, which is what `pt-14` was: 3px of
// slack, and the only hand-written chrome offset left in the app.
//
// Only reachable below `md:`, where the header is fixed. Above it the header is
// in flow, `md:pt-0` applies, and the sum is trivially exact — which is why the
// desktop centring test never saw this.
test.describe('the chrome around a list on a narrow viewport', () => {
  test.use({ viewport: { width: 412, height: 839 }, hasTouch: true });

  test('reserves exactly the header it sits under', async ({ page }) => {
    await setupApiMocks(page);
    // The profile is the page a phone gets in the list tree; a mouse gets every
    // page there, at any width under `md:`.
    await page.goto('/#/user/pg');
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

    // The reservation against the thing reserved, rather than against where the
    // first child happens to start — a margin there would be nobody's bug.
    const { reserved, header } = await page.evaluate(() => ({
      reserved: parseFloat(getComputedStyle(document.querySelector('main')!).paddingTop),
      header: document.querySelector('.app-header')!.getBoundingClientRect().height,
    }));

    expect(reserved).toBeCloseTo(header, 0);
  });

  test('leaves a full-page state fitting the viewport exactly', async ({ page, context }) => {
    await setupApiMocks(page);
    await page.goto('/#/no-such-route');
    await expect(page.getByText('Lost in the feed')).toBeVisible();
    // Offline so all three terms are non-zero: the state sizes itself as the
    // viewport less both tokens, so it fits only if both of `<main>`'s
    // reservations are those same tokens. This is what the 3px cost — a page
    // written to fit, scrolling.
    await setOfflineAndWaitForBar(page, context);

    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
        ),
      )
      .toBeLessThanOrEqual(1);
  });
});

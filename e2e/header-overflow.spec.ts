import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';
import {
  emulateBrowserFontSize,
  enlargeRootFont,
  scaleNavTextOnly,
} from './fixtures/layout-helpers';

/**
 * Where the packed row sits against the nav that holds it. `escaped` is how far
 * it breaks out leftward, which is the direction `justify-end` sends an overrun
 * — across the logo. Read off the real rects: those report layout, so the CSS
 * clip cannot hide a packing regression from these tests.
 */
const navBounds = (page: Page) =>
  page.evaluate(() => {
    const nav = document.querySelector('header nav')!;
    const navLeft = nav.getBoundingClientRect().left;
    const leftmost = Math.min(
      ...[...nav.children].map((c) => c.getBoundingClientRect().left),
    );
    return {
      escaped: navLeft - leftmost,
      leftmost,
      logoRight: document.querySelector('header a[href="#/"]')!.getBoundingClientRect().right,
    };
  });

/** The pill for the page you are on, which is the one that must never be lost. */
const activePill = (page: Page) =>
  page.getByRole('navigation', { name: 'Sections' }).locator('[aria-current="page"]');

/**
 * The hidden element the packer scales its glyph estimates against. Read
 * through `evaluate` rather than a locator: it is `visibility: hidden`, which
 * no amount of waiting will ever make visible.
 */
const probeWidth = (page: Page) =>
  page.evaluate(
    () => document.querySelector('header nav span.absolute')!.getBoundingClientRect().width,
  );

// End-to-end coverage for the responsive header's "More" overflow dropdown.
//
// The unit suite (Header.test.tsx) drives this surface synthetically by
// mocking `usePackedNav`, but only a real browser exercises:
//   - Radix's pointer-event open/close path
//   - the actual ResizeObserver-driven re-pack as the viewport changes
//   - the Portal mount + collisionPadding behavior at viewport edges
//   - keyboard focus trapping inside the dropdown content
//
// Routing-side: the existing Header tests prove that the active contextual
// pill ("user") sits at index 0 and the 3 feed tabs follow. We rely on
// that here by navigating to `/submitted/pg` — the canonical route for
// the User pill (the profile detail at `/user/:id` deliberately does NOT
// activate it; see `deriveHeaderState`) — where the pill is always
// visible at index 0 and the rest is up to the packer.

test.describe('Header overflow — More dropdown', () => {
  // Pin a viewport narrow enough that the User pill + the 3 feed tabs
  // exceed the available nav width and the packer hides at least one feed
  // into the dropdown. 320×568 is iPhone-SE-ish — a real device width and
  // the smallest viewport we still need to support gracefully.
  test.use({ viewport: { width: 320, height: 568 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  // User pill paint is the readiness signal: it proves the header has
  // mounted and run its first ResizeObserver-driven packing pass, AND
  // that the contextual-pill priority ordering put "user" at index 0.
  // Both are preconditions for every overflow assertion below.
  const userPill = (page: Page) =>
    page.locator('header nav span', { hasText: 'user' });

  test('shows the "More tabs" trigger when nav items overflow', async ({ page }) => {
    await page.goto('/#/submitted/pg');
    await expect(userPill(page)).toBeVisible();

    const moreBtn = page.getByRole('button', { name: 'More tabs' });
    await expect(moreBtn).toBeVisible();
    await expect(moreBtn).toHaveAttribute('aria-haspopup', 'menu');
    // Closed menus must NOT mount their portal content.
    await expect(page.getByRole('menuitem')).toHaveCount(0);
  });

  test('opens the menu on click and reveals hidden feed tabs as menuitems', async ({ page }) => {
    await page.goto('/#/submitted/pg');
    await expect(userPill(page)).toBeVisible();

    await page.getByRole('button', { name: 'More tabs' }).click();

    // Asserting on menuitem visibility is the strongest "menu actually
    // opened" signal. We avoid asserting `aria-expanded='true'` on the
    // trigger because Radix re-applies props via a Slot wrapper on open,
    // which can briefly invalidate any stored locator handle in Playwright
    // even though the underlying button is still in the DOM. The menuitem
    // existence test is the user-facing contract.
    await expect(page.getByRole('menuitem').first()).toBeVisible();
  });

  test('clicking a hidden feed in the menu navigates to that route', async ({ page }) => {
    await page.goto('/#/submitted/pg');
    await expect(userPill(page)).toBeVisible();

    // Sanity-check the precondition before exercising the menu: at this
    // viewport (320px) with the User pill active at index 0, the packer
    // should push Show out of the inline nav and into the dropdown. If
    // this assertion ever fails, the test below is no longer exercising
    // overflow — fail loudly here rather than silently passing via a
    // fallback path.
    const sectionsNav = page.getByRole('navigation', { name: 'Sections' });
    await expect(
      sectionsNav.getByRole('link', { name: 'show' }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'More tabs' }).click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();

    // Show MUST exist as a menuitem — the inline-nav assertion above proved
    // it's not in the bar, and the packer never drops items entirely.
    const showItem = page.getByRole('menuitem', { name: 'show' });
    await expect(showItem).toBeVisible();
    await showItem.click();
    // Either form is a pass: both prove navigation reached the show feed.
    // Which one shows up is the project's pointer, not this test's business —
    // a touch project mounts SwipeStoryViewer, which replaces the URL with
    // /item/:firstShowId (objectID 99999 in the mock) faster than Playwright's
    // first poll; a mouse gets the list at 320px and stays on /#/show.
    await expect(page).toHaveURL(/#\/(show|item\/99999)/);
  });

  test('Escape closes the open menu', async ({ page, browserName }) => {
    // Mobile webkit doesn't reliably forward keyboard events to focused
    // elements through Playwright; skip the keyboard-driven assertions there.
    test.skip(
      browserName === 'webkit',
      'Programmatic keyboard input not reliable on mobile webkit',
    );

    await page.goto('/#/submitted/pg');
    await expect(userPill(page)).toBeVisible();

    await page.getByRole('button', { name: 'More tabs' }).click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();

    await page.keyboard.press('Escape');
    // After Escape, Radix unmounts the menu's content portal — every
    // menuitem disappears from the DOM. Strongest signal that close
    // worked end-to-end.
    await expect(page.getByRole('menuitem')).toHaveCount(0);
  });

  test('keyboard: Enter on the focused trigger opens the menu', async ({ page, browserName }) => {
    test.skip(
      browserName === 'webkit',
      'Programmatic keyboard input not reliable on mobile webkit',
    );

    await page.goto('/#/submitted/pg');
    await expect(userPill(page)).toBeVisible();

    await page.getByRole('button', { name: 'More tabs' }).focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('menuitem').first()).toBeVisible();
  });
});

// The packer fills the row in canonical order, so the one slot a 320px bar
// has went to Best whichever feed you opened — the active pill was reachable
// only by opening the menu it had been packed into. Header pins the active
// item now; this is that fix meeting a real ResizeObserver.
test.describe('Header overflow — the active feed keeps its pill', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  // Label, not route key: New lives at /newest and renders as "new".
  for (const { route, label } of [
    { route: '/show', label: 'show' },
    { route: '/ask', label: 'ask' },
    { route: '/newest', label: 'new' },
  ]) {
    test(`${label} is in the bar, not the menu`, async ({ page }) => {
      await page.goto(`/#${route}`);

      // The trigger only renders once the packer has measured, so waiting on
      // it also proves the row overflowed — without that, a bar wide enough
      // for every tab would pass this test without exercising anything.
      await expect(page.getByRole('button', { name: 'More tabs' })).toBeVisible();

      const pill = page
        .getByRole('navigation', { name: 'Sections' })
        .getByRole('link', { name: label });
      await expect(pill).toBeVisible();
      await expect(pill).toHaveAttribute('aria-current', 'page');
    });
  }
});

// `comments` is the widest pill at 91.5px, and the trigger used to reserve
// 105px of a 320px phone's 200px nav for its separator and its label — so the
// pill the reader was actually looking at lost the row by a single pixel.
test.describe('Header overflow — the widest pill still fits a phone', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('the comments pill is in the bar, not the menu', async ({ page }) => {
    await setupApiMocks(page);
    // 1002 is a comment, so the header's contextual cascade picks `comments`.
    await page.goto('/#/item/1002');

    // Same reasoning as the feed guards above: the trigger's presence is what
    // proves the row overflowed and the pill won a contested slot.
    await expect(page.getByRole('button', { name: 'More tabs' })).toBeVisible();

    const active = page
      .getByRole('navigation', { name: 'Sections' })
      .locator('[aria-current="page"]');
    await expect(active).toHaveText('comments');
  });
});

// Two shapes where the row outgrew the nav rather than the menu. Because the
// nav is `justify-end`, the excess spills leftward across the logo: at 412px
// and 150% the leading pill sat 78px outside the nav, and below ~200px the
// trigger's own label did the same. Measured on the real rects, which report
// layout, so the CSS clip cannot mask a packing regression here.
test.describe('Header overflow — the row stays inside the nav', () => {
  for (const shape of [
    { label: '412px at a 150% font', width: 412, height: 800, rootPx: 24 },
    { label: '164px at the default font', width: 164, height: 809, rootPx: null },
  ]) {
    test(`no pill escapes the nav at ${shape.label}`, async ({ page }) => {
      if (shape.rootPx) await enlargeRootFont(page, shape.rootPx);
      await page.setViewportSize({ width: shape.width, height: shape.height });
      await setupApiMocks(page);
      await page.goto('/#/best');

      // Polled because the first frame legitimately renders every item: the
      // packer has no width until it has measured one. A pixel of slack for
      // subpixel layout — the regressions here were 78px and 32px.
      await expect
        .poll(async () => (await navBounds(page)).escaped, {
          message: 'the packed row must settle inside the nav',
        })
        .toBeLessThanOrEqual(1);

      const { leftmost, logoRight } = await navBounds(page);
      expect(leftmost).toBeGreaterThan(logoRight);

      // Both shapes overflow, so the trigger proves the packer engaged at all
      // — without it a bar wide enough for every tab would pass unexercised.
      await expect(page.getByRole('button', { name: 'More tabs' })).toBeVisible();
    });
  }
});

// Android scales text without moving a single `rem` length, so the nav keeps
// its width, no observer of the nav fires, and the packer's estimates go
// quietly stale. On a comment view at 320px that spilled the row 10px over the
// logo at 1.3× and 27px at 1.5× — and being right-aligned, the pill it clipped
// was the active one. The hidden probe in the nav is what notices.
test.describe('Header overflow — text that grows on its own', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  for (const factor of [1.3, 1.5]) {
    test(`the active pill survives ${factor}× text, inside the nav`, async ({ page }) => {
      await setupApiMocks(page);
      // 1002 is a comment: the widest pill, and the thinnest slack.
      await page.goto('/#/item/1002');
      await expect(activePill(page)).toHaveText('comments');

      await scaleNavTextOnly(page, factor);

      await expect
        .poll(async () => (await navBounds(page)).escaped, {
          message: 'the row must re-pack when only the text inside it grows',
        })
        .toBeLessThanOrEqual(1);

      // Containment alone would also be satisfied by dropping every pill.
      await expect(activePill(page)).toHaveText('comments');
    });
  }
});

// The other half of the same question, and the one the injected root font in
// `enlargeRootFont` cannot ask: a real font setting also moves the `rem` media
// queries, so the layout around the nav changes shape at the same time.
test.describe("Header overflow — the browser's own font setting", () => {
  test.use({ viewport: { width: 412, height: 800 } });

  test('a 24px default keeps the active pill in a contained row', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'only Chromium can emulate the setting');
    await emulateBrowserFontSize(page, 24);
    await setupApiMocks(page);
    await page.goto('/#/item/1002');

    // The premise everything above rests on: no stylesheet of ours pins the
    // root font size. One `html { font-size: 16px }` would overrule the reader
    // outright — the packer would read 16 and be right, and every `rem` in the
    // app would quietly stop scaling. Nothing else in the suite would notice.
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
    ).toBe('24px');

    await expect
      .poll(async () => (await navBounds(page)).escaped, {
        message: 'the packed row must settle inside the nav',
      })
      .toBeLessThanOrEqual(1);

    await expect(activePill(page)).toHaveText('comments');
    await expect(page.getByRole('button', { name: 'More tabs' })).toBeVisible();
  });
});

// The probe stands in for a pill's label, and is a reading of the reader's
// text size only for as long as it renders like one: the same typography, and
// a width that owes nothing to the box around it. The second is why it is
// positioned out of flow — at 164px the nav is 44px, narrower than the word
// itself, and a probe that took its container's width instead would report a
// reader who had shrunk their text, which is the direction that overfills a
// row rather than the safe one.
test.describe('Header overflow — the probe reads like a pill', () => {
  test('it measures the active pill, less that pill’s padding', async ({ page }) => {
    await setupApiMocks(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/#/item/1002');
    await expect(activePill(page)).toHaveText('comments');

    const { probe, glyphs } = await page.evaluate(() => {
      const nav = document.querySelector('header nav')!;
      const pill = nav.querySelector('[aria-current="page"]')!;
      return {
        probe: nav.querySelector('span.absolute')!.getBoundingClientRect().width,
        // `px-2.5` a side; what is left is the label itself.
        glyphs: pill.getBoundingClientRect().width - 20,
      };
    });

    // A relation, not a number: what the probe measures is a platform's font,
    // and TEXT_PROBE_BASELINE is one platform's reading of it. This machine
    // renders `comments` at 71.5px and CI's Linux stack at 67.7px, both
    // correct — the scale between them is the whole point of measuring.
    expect(probe).toBeCloseTo(glyphs, 1);
  });

  test('it measures its own word, not the narrower nav around it', async ({ page }) => {
    await setupApiMocks(page);
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/#/best');
    await expect(activePill(page)).toHaveText('best');
    const roomy = await probeWidth(page);

    await page.setViewportSize({ width: 164, height: 809 });
    await expect(page.getByRole('button', { name: 'More tabs' })).toBeVisible();

    // 44px of nav against a word wider than that: an in-flow probe would be
    // squeezed to its container and read as a reader who shrank their text.
    expect(roomy).toBeGreaterThan(44);
    expect(await probeWidth(page)).toBeCloseTo(roomy, 1);
  });
});

test.describe('Header overflow — the trigger stays a target', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('the bare chevron is as tall as the pills beside it', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/#/item/1002');

    const trigger = page.getByRole('button', { name: 'More tabs' });
    await expect(trigger).toBeVisible();
    const box = (await trigger.boundingBox())!;

    // Dropping the label drops the line box with it, leaving a 14px icon to
    // set the height: 22px, under the 24×24 WCAG 2.5.8 (AA) asks for.
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect(box.width).toBeGreaterThanOrEqual(24);

    const pill = (await activePill(page).boundingBox())!;
    expect(box.height).toBeCloseTo(pill.height, 0);
  });
});

test.describe('Theme toggle — accessible label', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('theme toggle button has an accessible label describing the action', async ({ page }) => {
    await page.goto('/#/');
    await expect(
      page.getByText('Rust Is the Future of JavaScript Infrastructure').first(),
    ).toBeVisible();

    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toHaveAccessibleName(/switch to (system|light|dark)/i);
  });
});

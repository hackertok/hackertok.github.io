import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mocks';

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
// that here by navigating to `/user/pg`, where the User pill is always
// visible at index 0 — the rest is then up to the packer.

test.describe('Header overflow — More dropdown', () => {
  // Pin a viewport narrow enough that the User pill + the 3 feed tabs
  // exceed the available nav width and the packer hides at least one feed
  // into the dropdown. 320×568 is iPhone-SE-ish — a real device width and
  // the smallest viewport we still need to support gracefully.
  test.use({ viewport: { width: 320, height: 568 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('shows the "More tabs" trigger when nav items overflow', async ({ page }) => {
    await page.goto('/#/user/pg');

    // Wait for the user-page content to render so the header has a chance
    // to mount and run its first packing pass via ResizeObserver.
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

    const moreBtn = page.getByRole('button', { name: 'More tabs' });
    await expect(moreBtn).toBeVisible();
    await expect(moreBtn).toHaveAttribute('aria-haspopup', 'menu');
    // Pre-open: menu is closed, no menuitems are mounted in the portal.
    await expect(page.getByRole('menuitem')).toHaveCount(0);
  });

  test('opens the menu on click and reveals hidden feed tabs as menuitems', async ({ page }) => {
    await page.goto('/#/user/pg');
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

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
    await page.goto('/#/user/pg');
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

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
    // Wait for the menu to render before fishing inside it.
    await expect(page.getByRole('menuitem').first()).toBeVisible();

    // Show MUST exist as a menuitem (we just asserted it isn't in the
    // inline nav, and the packer never drops items entirely).
    const showItem = page.getByRole('menuitem', { name: 'show' });
    await expect(showItem).toBeVisible();
    await showItem.click();
    await expect(page).toHaveURL(/#\/show/);
  });

  test('Escape closes the open menu', async ({ page, browserName }) => {
    // Mobile webkit doesn't reliably forward keyboard events to focused
    // elements through Playwright; skip the keyboard-driven assertions there.
    test.skip(
      browserName === 'webkit',
      'Programmatic keyboard input not reliable on mobile webkit',
    );

    await page.goto('/#/user/pg');
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

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

    await page.goto('/#/user/pg');
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();

    await page.getByRole('button', { name: 'More tabs' }).focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('menuitem').first()).toBeVisible();
  });
});

test.describe('Theme toggle — tooltip on hover', () => {
  // Hover-driven tooltip text is unique to this control (it's the only
  // icon-only header button). Mobile devices don't fire hover events the
  // same way, so we restrict to non-mobile projects.
  test.skip(({ browserName }) => browserName === 'webkit', 'No hover on mobile webkit');

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('hovering the theme toggle reveals the tooltip text', async ({ page }) => {
    await page.goto('/#/');
    // Wait for content load so Tooltip provider is mounted.
    await expect(
      page.getByText('Rust Is the Future of JavaScript Infrastructure').first(),
    ).toBeVisible();

    const toggle = page.getByTestId('theme-toggle');
    await toggle.hover();

    // TooltipProvider in App.tsx is configured with delayDuration=250ms.
    // The tooltip role + accessible name comes from the rendered
    // TooltipContent inside the Radix portal.
    await expect(
      page.getByRole('tooltip', { name: /switch to (dark|light) mode/i }),
    ).toBeVisible({ timeout: 3000 });
  });
});

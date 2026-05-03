import type { AxeResults } from 'axe-core';
import type { Page } from '@playwright/test';
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

/**
 * Wait for the active PageStage cascade to settle before axe scans.
 *
 * `<PageStage>` runs a 3-state machine that fades a skeleton overlay
 * out (320ms) while real content animates in via a decay-stagger
 * cascade (~360ms per element). During the `'transitioning'` window,
 * elements have CSS-animated opacity 0 → 1 — and axe-core's
 * color-contrast check captures the COMPUTED colour at scan time,
 * which means a partially-faded title resolves to (e.g.) `#cfcbc7` on
 * a light cream background instead of the resting `#3a3631`. That
 * trips the WCAG 4.5:1 threshold for every animated element.
 *
 * The skeleton overlay is unmounted when `PageStage` reaches the
 * `'done'` state at t=1200ms after `loading` flips false, which is a
 * cheap proxy for "cascade finished, real elements at opacity 1".
 * Waiting on its disappearance gives axe deterministic resting-state
 * colours without disabling animations entirely (which would make the
 * test stop exercising the normal-motion path).
 *
 * On mobile, the homepage and item-detail routes render as a swipe
 * stack of `<FullScreenItem>` panels — each with its own `PageStage`
 * gated by `triggerWhen={isPriority}`. Only the active/visible panel
 * transitions; off-screen, low-priority panels intentionally stay in
 * the `'skeleton'` state to defer animation work. So we scope this
 * wait to the FIRST `.page-stage` (the leftmost / starting panel,
 * which is the only one axe sees with foreground content the user is
 * actually viewing). Non-priority panels keep their content at
 * `opacity: 0`, which axe-core's contrast checker correctly skips.
 */
async function waitForCascadeSettled(page: Page) {
  await expect(
    page.locator('.page-stage').first().locator('.skeleton-overlay')
  ).toHaveCount(0, { timeout: 3000 });
}

test.describe('Accessibility', () => {
  // axe-core scans on a fully-rendered DOM are slow; per-test timeout
  // must cover load + cascade settle + analyze.
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('homepage has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    await waitForCascadeSettled(page);

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);
  });

  test('item detail page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/item/12345');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();
    // Comments must be in DOM so axe scans .comment-content links (text-accent contrast).
    await expect(page.getByRole('link', { name: 'wasm-bindgen' }).first()).toBeVisible();
    await waitForCascadeSettled(page);

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);
  });

  test('theme toggle is keyboard accessible', async ({ page }) => {
    await page.goto('/#/');

    const themeToggle = page.getByTestId('theme-toggle');
    await themeToggle.focus();

    await expect(themeToggle).toBeFocused();

    await page.keyboard.press('Enter');

    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);
  });

  test('navigation is keyboard accessible', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Tab navigation not supported on mobile webkit');

    await page.goto('/#/');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    const interactiveTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];

    await page.keyboard.press('Tab');
    const firstTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(interactiveTags).toContain(firstTag);

    // Compare identity (id or href), not tag — two <A>s in a row would
    // pass a tag-only check even if focus didn't actually move.
    const firstIdentity = await page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('href'));
    await page.keyboard.press('Tab');
    const secondTag = await page.evaluate(() => document.activeElement?.tagName);
    const secondIdentity = await page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('href'));
    expect(interactiveTags).toContain(secondTag);
    expect(secondIdentity).not.toEqual(firstIdentity);
  });

  test('external links have valid URLs', async ({ page }) => {
    await page.goto('/#/');

    const externalLink = page.getByRole('link', { name: 'Rust Is the Future of JavaScript Infrastructure' });
    await expect(externalLink).toBeVisible();

    const href = await externalLink.getAttribute('href');
    expect(href).toContain('https://example.com');
  });

  test('best stories page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/best');

    await expect(page.getByText('The Art of Finishing Projects')).toBeVisible({ timeout: 10000 });
    // Active nav pill (bg-accent / text-accent-foreground) exercises accent contrast.
    await expect(page.getByRole('link', { name: 'best', exact: true })).toBeVisible();
    await waitForCascadeSettled(page);

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);
  });

  test('domain filter page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/from/example.com');

    await expect(page.getByText('Google Announces Gemini 3.0 with Extended Context')).toBeVisible({ timeout: 10000 });
    await waitForCascadeSettled(page);

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);
  });

  test('user profile page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/user/pg');

    // Heading + submissions link must both be in DOM so axe covers the
    // username heading, karma/age meta row, submissions link, and about text.
    await expect(page.getByRole('heading', { level: 1, name: 'pg' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'submissions' })).toBeVisible();
    await waitForCascadeSettled(page);

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);
  });

  test('user submissions page has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/submitted/pg');

    // Submissions list must render so axe scans StoryCard byline links
    // (font-medium / accent-hover contrast) on this route.
    await expect(page.getByText('Beating the Averages')).toBeVisible({ timeout: 10000 });
    await waitForCascadeSettled(page);

    const accessibilityScanResults = await makeAxeBuilder().analyze();
    attachIncomplete(accessibilityScanResults);

    const seriousViolations = accessibilityScanResults.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);
  });
});

test.describe('Accessibility - Dark Mode', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Emulate before navigation so ThemeContext reads dark on mount.
    await page.emulateMedia({ colorScheme: 'dark' });
  });

  test('dark mode has no critical accessibility violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/#/');

    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await expect(page.locator('html')).toHaveClass(/dark/);
    await waitForCascadeSettled(page);

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
    // Comments must be in DOM so axe scans .comment-content links (text-accent contrast).
    await expect(page.getByRole('link', { name: 'wasm-bindgen' }).first()).toBeVisible();
    await waitForCascadeSettled(page);

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
    // Submissions link uses font-weight for emphasis (no button bg) — its
    // text-only contrast must be checked specifically in dark mode.
    await expect(page.getByRole('link', { name: 'submissions' })).toBeVisible();
    await waitForCascadeSettled(page);

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
    await waitForCascadeSettled(page);

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
    await waitForCascadeSettled(page);

    // setOffline alone doesn't always flip navigator.onLine in time;
    // dispatch the event manually to make the offline transition reliable.
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
    await waitForCascadeSettled(page);

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
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/#/');
    await expect(page.getByText('Rust Is the Future of JavaScript Infrastructure').first()).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.getByText('No internet connection')).toBeVisible({ timeout: 5000 });

    // animation-name: none (not the slide-up keyframe) is the contract for
    // the @media (prefers-reduced-motion) override on .network-status-bar.
    const barAnimation = await page.evaluate(() => {
      const bar = document.querySelector('.network-status-bar');
      return bar ? getComputedStyle(bar).animationName : null;
    });
    expect(barAnimation).toBe('none');
  });

  test('disables StateView scene animations when reduced motion is preferred', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // 99999999 returns null → renders StateView with the animated scene.
    await page.goto('/#/item/99999999');
    await expect(page.getByText(/not found/i)).toBeVisible();

    // animation-iteration-count: 1 is the reduced-motion contract: scene
    // plays once instead of looping.
    const sceneAnimation = await page.evaluate(() => {
      const scene = document.querySelector('.sv-scene');
      if (!scene) return null;
      const style = getComputedStyle(scene);
      return { iterationCount: style.animationIterationCount };
    });
    expect(sceneAnimation).toBeTruthy();
    expect(sceneAnimation!.iterationCount).toBe('1');
  });

  test('disables PageStage cascade animations and hides the skeleton overlay when reduced motion is preferred', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Emulate BEFORE navigation so the @media query resolves at first
    // paint and the cascade overrides apply on initial render.
    await page.goto('/#/');

    // Wait for cards to mount under the matched media query. Picking a
    // mid-list card (.stagger-fade is the per-card animation class)
    // sidesteps the story-stage-leader title which has its own rule.
    const card = page.locator('.stagger-fade').first();
    await expect(card).toBeAttached({ timeout: 5000 });

    // Reduced-motion contract on `.stagger-fade` (and siblings):
    //   animation: none !important;
    //   opacity:   1     !important;
    // The `!important` is load-bearing because it has to beat the
    // (3,0,0)-specificity `:not(.fade-skeleton)` opacity:0 rule that
    // hides the cards in the skeleton state. If the cascade ever leaks
    // into reduced-motion, AT users would see opacity:0 cards or
    // motion they explicitly opted out of.
    const cardStyles = await card.evaluate((el) => {
      const style = getComputedStyle(el);
      return { animationName: style.animationName, opacity: style.opacity };
    });
    expect(cardStyles.animationName).toBe('none');
    expect(cardStyles.opacity).toBe('1');

    // .skeleton-overlay should be `display: none` under reduced motion
    // — the choreography is skipped entirely, the user lands directly
    // on the resting content.
    const overlayDisplay = await page.evaluate(() => {
      const overlay = document.querySelector('.skeleton-overlay');
      return overlay ? getComputedStyle(overlay).display : 'unmounted';
    });
    // PageStage may have already reached 'done' (overlay unmounted)
    // OR still be in skeleton/transitioning with the overlay rendered
    // but display:none — either is a pass for the reduced-motion
    // contract (no skeleton ever paints).
    expect(['none', 'unmounted']).toContain(overlayDisplay);
  });

  test('disables .reply-fade animation when reduced motion is preferred', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Emulate BEFORE navigation so the @media query resolves at first
    // paint and the override applies the moment .reply-fade children
    // mount on expand.
    await page.goto('/#/item/12345');

    // Wait for the top-level comment to mount, then expand its reply
    // tree. Mock data: comment 1001 (patio11) has child 2001 (tptacek).
    await expect(page.getByText('patio11').first()).toBeVisible({ timeout: 10000 });
    await page.getByText(/1 reply/i).first().click();
    await expect(page.getByText('tptacek').first()).toBeVisible();

    // Override target is `.reply-fade > *` (the inner Comment), NOT
    // the .reply-fade wrapper itself. The wrapper has to stay opaque
    // because it carries `.tree-branch::before` + `.tree-branch--last
    // ::after` — the trunk connector and trunk-end mask. If the
    // selector ever drifts (the rule and the override are paired in
    // src/index.css and easy to evolve out of sync), AT users get
    // opacity:0 replies and the cascade animation they opted out of,
    // on every expand.
    const replyChild = page.locator('.reply-fade > *').first();
    await expect(replyChild).toBeAttached();

    const replyStyles = await replyChild.evaluate((el) => {
      const style = getComputedStyle(el);
      return { animationName: style.animationName, opacity: style.opacity };
    });
    expect(replyStyles.animationName).toBe('none');
    expect(replyStyles.opacity).toBe('1');
  });
});

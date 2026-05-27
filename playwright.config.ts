import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

/**
 * Playwright E2E test configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    /* Record video on first retry — avoid per-test recording overhead */
    video: 'on-first-retry',
    actionTimeout: 10 * 1000,

    /* Pin locale + timezone so any rendered date/number is deterministic
       across CI runs and contributor machines. UserProfile renders an
       absolute creation date via formatAbsoluteDate (e.g. "October 9, 2006"),
       which would otherwise drift by host TZ/locale. NOTE: per-project `use`
       overrides top-level `use` for any field the device descriptor sets, so
       the same pair is also added inside each per-project block below. */
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], locale: 'en-US', timezoneId: 'UTC' },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], locale: 'en-US', timezoneId: 'UTC' },
    },
    {
      name: 'Mobile Safari',
      use: { 
        ...devices['iPhone 15'],
        locale: 'en-US',
        timezoneId: 'UTC',
      },
    },
    {
      name: 'Mobile Chrome',
      use: { 
        ...devices['Pixel 7'],
        locale: 'en-US',
        timezoneId: 'UTC',
      },
    },
  ],
  outputDir: 'e2e/test-results',
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NODE_OPTIONS: '--disable-warning=DEP0205' },
  },
  timeout: 30 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
});

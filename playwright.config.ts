import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

/**
 * Playwright E2E test configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  
  /* Run tests in files in parallel */
  fullyParallel: true,
  
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: isCI,
  
  /* Retry flaky tests - 1 locally, 2 on CI */
  retries: isCI ? 2 : 1,
  
  /* Reporter to use */
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  
  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: 'http://localhost:4173',

    /* Collect trace on first retry (screenshots still captured on every failure) */
    trace: 'on-first-retry',
    
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Record video on first retry — avoid per-test recording overhead */
    video: 'on-first-retry',
    
    /* Consistent action timeout */
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

  /* Configure projects for major browsers */
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

  /* Output directory for test artifacts */
  outputDir: 'e2e/test-results',

  /* Always build + serve static files for e2e tests */
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  
  /* Increase test timeout for slower CI environments */
  timeout: 30 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
});

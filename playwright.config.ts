import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  
  /* Run tests in files in parallel */
  fullyParallel: true,
  
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  
  /* Retry flaky tests - 1 locally, 2 on CI */
  retries: process.env.CI ? 2 : 1,
  
  /* Use half of available CPU cores on CI (2 workers on 4-core GitHub Actions runner) */
  workers: process.env.CI ? '50%' : undefined,
  
  /* Reporter to use */
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  
  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: 'http://localhost:5173',

    /* Collect trace on first retry (screenshots still captured on every failure) */
    trace: 'on-first-retry',
    
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Record video on first retry — avoid per-test recording overhead */
    video: 'on-first-retry',
    
    /* Consistent action timeout */
    actionTimeout: 10 * 1000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'Mobile Safari',
      use: { 
        ...devices['iPhone 15'],
        hasTouch: true,
      },
    },
    {
      name: 'Mobile Chrome',
      use: { 
        ...devices['Pixel 7'],
        hasTouch: true,
      },
    },
  ],

  /* Output directory for test artifacts */
  outputDir: 'e2e/test-results',

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
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

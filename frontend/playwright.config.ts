import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for guest-practice E2E.
 *
 * Uses the locally-installed Microsoft Edge instead of Playwright's
 * bundled Chromium so we don't have to download a separate browser
 * binary (~150MB). Edge is a Chromium-derivative, so DOM behavior is
 * identical for our Next.js frontend.
 *
 * Run:  cd frontend && npx playwright test
 */

const EDGE_PATH =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'edge-local',
      use: {
        ...devices['Desktop Chrome'],
        channel: undefined,
        launchOptions: {
          executablePath: EDGE_PATH,
        },
      },
    },
  ],
});
import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Playwright config for guest-practice E2E.
 *
 * Browser selection (in order):
 *   1. Locally-installed Microsoft Edge on Windows.
 *   2. Playwright's auto-discovered Chromium (headless_shell) cache
 *      on macOS / Linux. Avoids the bundled-Chromium download.
 *   3. Playwright's bundled chromium if nothing else is found.
 *      Install with: `npx playwright install chromium`.
 *
 * Run:  cd frontend && npx playwright test
 */

/**
 * Resolve a browser executable path, or return null to let Playwright
 * pick its bundled Chromium. On Windows we try the standard Edge
 * install path; on macOS / Linux we try the Playwright headless_shell
 * cache (created by `npx playwright install chromium-headless-shell`,
 * or as a side-effect of running other tests).
 */
function resolveBrowserExecutable(): string | null {
  if (os.platform() === 'win32') {
    const candidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  // macOS / Linux: probe Playwright's ms-playwright cache.
  const home = os.homedir();
  const base = `${home}/Library/Caches/ms-playwright`;
  if (!fs.existsSync(base)) return null;

  // ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/*/chrome-headless-shell
  // Pick the most recent match by mtime so multi-version caches don't
  // pin us to an old build.
  let best: string | null = null;
  let bestMtime = 0;
  try {
    for (const top of fs.readdirSync(base)) {
      if (!top.startsWith('chromium_headless_shell-')) continue;
      const inner = `${base}/${top}`;
      for (const sub of fs.readdirSync(inner)) {
        const exe = `${inner}/${sub}/chrome-headless-shell`;
        if (!fs.existsSync(exe)) continue;
        const m = fs.statSync(exe).mtimeMs;
        if (m > bestMtime) {
          bestMtime = m;
          best = exe;
        }
      }
    }
  } catch {
    /* dir unreadable — fall through to chromium download */
  }
  return best;
}

const EXECUTABLE_PATH = resolveBrowserExecutable();

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
      name: EXECUTABLE_PATH ? 'edge-or-chromium' : 'chromium-bundled',
      use: {
        ...devices['Desktop Chrome'],
        channel: undefined,
        ...(EXECUTABLE_PATH
          ? { launchOptions: { executablePath: EXECUTABLE_PATH } }
          : {}),
      },
    },
  ],
});

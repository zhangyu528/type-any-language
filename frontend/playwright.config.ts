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
 * 专用测试端口（不复用 dev 的 :3000 / :8000）：
 *   - webServer 起一个独立的 next dev 在 :3100，测试默认走这里。
 *   - 后端不需要真实服务：signup 等用例用 page.route 全程 mock
 *     （见 tests/e2e/*.spec.ts），无需 docker postgres / uvicorn。
 *   - 若 :3100 已有实例（如你手动起的测试服务），webServer 会复用它
 *     （reuseExistingServer: true），不会冲突。
 *
 * ⚠️ 运行前必须旁路 WorkBuddy 的 safe-delete 垫片（否则 next dev 在生成
 *    .next/trace 时会被拦截 unlink 而崩溃）：
 *      env NODE_OPTIONS= BASH_ENV= npx playwright test
 *    该垫片通过环境变量注入，本进程及其 webServer 子进程都会继承「已清除」
 *    的环境，故 webServer 命令本身无需再清。
 *
 * Run:  cd frontend && env NODE_OPTIONS= BASH_ENV= npx playwright test
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

// 专用测试端口：默认 :3100 跑 dev,设 E2E_PROD=1 切到 prod (next start,需先 build)。
// 性能测试 (landing.perf.spec.ts) 只在 prod 跑才有意义(dev 数字被 HMR / source maps
// 严重污染,跟用户实际体验脱节 2-3 倍),其他 e2e 仍跑 dev。
const E2E_PORT = process.env.E2E_PORT || '3100';
const E2E_PROD = process.env.E2E_PROD === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  // 专用测试服务:默认 next dev (其他 e2e 用);prod 性能测试走 E2E_PROD=1 + next start。
  // CI 跑 prod 测试需要先 `npm run build`(pretest:prod 自动跑)。
  // 首次冷编译较慢,给 2 分钟就绪超时。
  webServer: {
    command: E2E_PROD
      ? `npx next start -p ${E2E_PORT}`
      : `npx next dev -p ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  use: {
    // 默认专用测试端口 :3100；CI / 本地不同端口可用 E2E_BASE_URL 覆盖，
    // 例如 E2E_BASE_URL=http://localhost:3100 npx playwright test。
    baseURL: process.env.E2E_BASE_URL || `http://localhost:${E2E_PORT}`,
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

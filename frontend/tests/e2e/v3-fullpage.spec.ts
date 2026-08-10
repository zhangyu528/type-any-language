import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../tmp/screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test('V3 landing — full-page screenshot (light + dark)', async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.removeItem('tal.user'); } catch {}
  });
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);

  // 浅色模式 fullPage
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, '05-fullpage-light.png'),
    fullPage: true,
  });

  // 切到 dark 模式
  await page.evaluate(() => {
    try { window.localStorage.setItem('landing.theme', 'dark'); } catch {}
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);

  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, '06-fullpage-dark.png'),
    fullPage: true,
  });
});
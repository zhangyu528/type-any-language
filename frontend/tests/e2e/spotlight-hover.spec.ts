import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../tmp/screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test('V3 spotlight — hover on first lib card', async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.removeItem('tal.user'); } catch {}
  });
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // 滚到 lib-showcase
  const libSection = page.locator('#lib-showcase');
  await libSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  // 把鼠标移到第一张词库卡中心
  const firstCard = page.locator('#lib-showcase button[aria-label^="进入"]').first();
  await firstCard.hover({ position: { x: 80, y: 50 } });
  await page.waitForTimeout(800); // 等 spotlight overlay 淡入

  // 截图
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, '07-spotlight-hover.png'),
    fullPage: false,
  });
});
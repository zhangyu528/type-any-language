import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../tmp/screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.describe('V3 landing — screenshot pass', () => {
  test('hero bento + lib showcase + how-it-works visible', async ({ page }) => {
    await page.addInitScript(() => {
      try { window.localStorage.removeItem('tal.user'); } catch {}
    });

    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2200);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-hero-bento.png'),
      fullPage: false,
    });

    const libSection = page.locator('#lib-showcase');
    await libSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-lib-showcase.png'),
      fullPage: false,
    });

    const howSection = page.locator('#how-it-works');
    await howSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-how-it-works.png'),
      fullPage: false,
    });

    await expect(page.locator('h1', { hasText: '肌肉记忆' })).toBeVisible();
    await expect(page.locator('text=收录词数').first()).toBeVisible();
    await expect(page.locator('text=首推词库').first()).toBeVisible();
  });

  test('hero dark theme — ShinyText sweep visible', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('landing.theme', 'dark');
      } catch {}
    });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2200);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-hero-dark.png'),
      fullPage: false,
    });
  });

  test('click a lib card goes to practice', async ({ page }) => {
    await page.addInitScript(() => {
      try { window.localStorage.removeItem('tal.user'); } catch {}
    });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const libSection = page.locator('#lib-showcase');
    await libSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    const cards = page.locator('#lib-showcase button[aria-label^="进入"]');
    const count = await cards.count();
    console.log(`lib card count = ${count}`);
    expect(count).toBeGreaterThanOrEqual(3);

    await cards.first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    const url = page.url();
    console.log(`after click url = ${url}`);
    expect(url).not.toBe('http://localhost:3000/');
  });
});
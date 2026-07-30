/**
 * landing-page.spec.ts — E2E acceptance for the LandingPage shell
 * (Hero CTA + Footer). Lives alongside guest-practice.spec.ts so the
 * two surfaces each own their regression suite.
 *
 * Conventions:
 *   - Reset localStorage + cookies between tests so auth state and
 *     prefs.libId start clean.
 *   - The "logged-in" scenarios stub /api/auth/me so we don't need a
 *     real test user. The /api/auth/me response is read by useAuth()
 *     on mount; mocking it before goto() is enough.
 */

import { test, expect, type Page } from '@playwright/test';

async function freshPage(page: Page) {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

/**
 * Stub /api/auth/me so useAuth() hydrates a logged-in user on first
 * render. Must be installed BEFORE goto('/'). The response shape must
 * match backend auth.py::me exactly: { user: { ... } } — and the
 * inner object must include `display_name` because AppHeader reads
 * `user.display_name.charAt(0)` and crashes on undefined.
 */
async function stubLoggedInUser(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'test-user',
          email: 'tester@example.com',
          username: 'tester',
          display_name: 'Tester',
        },
      }),
    }),
  );
}

test.describe('LandingPage — Hero CTA + Footer', () => {
  test('未登录：CTA 显示「立即开始练习」，点击直进练习页（不再跳 /login）', async ({
    page,
  }) => {
    await freshPage(page);
    const cta = page.getByRole('button', { name: /立即开始练习/ });
    await expect(cta).toBeVisible();
    await cta.click();
    // Lands on /?lib=<libs[0].id> — the practice page itself, with
    // no /login detour.
    await expect(page).toHaveURL(/\?lib=[a-f0-9-]+/);
    expect(page.url()).not.toContain('/login');
  });

  test('已登录 + 无 prefs.libId：URL 重定向到 /history', async ({ page }) => {
    await stubLoggedInUser(page);
    await page.goto('/');
    // LandingPage is guest-only; logged-in users should land on /history.
    await expect(page).toHaveURL(/\/history/);
  });

  test('已登录 + prefs.libId 在 catalog：仍然跳 /history（prefs.libId 不影响 landing）', async ({
    page,
  }) => {
    await stubLoggedInUser(page);
    // Seed prefs.libId with libs[1] so we can verify it doesn't keep
    // the user on / — LandingPage is not the auth surface.
    const catalogRes = await page.request.get(
      'http://localhost:8000/api/content/catalog',
    );
    expect(catalogRes.ok()).toBeTruthy();
    const catalog = (await catalogRes.json()) as { libs: Array<{ id: string }> };
    expect(catalog.libs.length).toBeGreaterThanOrEqual(2);

    await page.goto('/');
    await page.evaluate((libId) => {
      window.localStorage.setItem('prefs.libId', libId);
    }, catalog.libs[1].id);
    await page.reload();

    await expect(page).toHaveURL(/\/history/);
  });

  test('已登录 + prefs.libId 已被 catalog 移除：仍然跳 /history', async ({
    page,
  }) => {
    await stubLoggedInUser(page);
    await page.goto('/');
    // Seed an obviously-stale libId; the catalog has none matching it.
    await page.evaluate(() => {
      window.localStorage.setItem(
        'prefs.libId',
        '00000000-0000-0000-0000-000000000000',
      );
    });
    await page.reload();

    await expect(page).toHaveURL(/\/history/);
  });

  test('Footer GitHub 链接指向仓库 URL（不是 github.com 首页）', async ({
    page,
  }) => {
    await freshPage(page);
    const link = page.getByRole('link', { name: 'GitHub' });
    await expect(link).toHaveAttribute(
      'href',
      'https://github.com/zhangyu528/type-any-language',
    );
  });

  test('AppHeader brand 是不可点击的（不是 link，不带 href）', async ({
    page,
  }) => {
    await freshPage(page);
    // The brand text should exist in the header but NOT be exposed
    // as a link by accessibility tree (no <a> wrapping it).
    const brand = page.locator('.app-header__brand');
    await expect(brand).toBeVisible();
    await expect(brand).toContainText('Type Any Language');
    // No link wraps the brand: query for <a> inside the brand and
    // expect zero hits.
    const linkCount = await brand.locator('a').count();
    expect(linkCount).toBe(0);
  });

  test('AppHeader brand mark 是 3×3 dot matrix SVG（不是 enso 圆环）', async ({
    page,
  }) => {
    await freshPage(page);
    // The new BrandMark renders a 3×3 grid of <circle>s inside the
    // mark container. Count = 9.
    const markSvg = page.locator('.app-header__brand-mark svg');
    await expect(markSvg).toBeVisible();
    const circleCount = await markSvg.locator('circle').count();
    expect(circleCount).toBe(9);
    // And it's the "Type Any Language" brand label, not an old label.
    await expect(markSvg).toHaveAttribute('aria-label', 'Type Any Language');
  });

  test('Hero 显示 BrandMark（72px，pulse 模式）', async ({ page }) => {
    await freshPage(page);
    // Hero's BrandMark is the only 72×72 SVG inside the hero section.
    const heroMark = page.locator('section[aria-label="产品介绍"] svg').first();
    await expect(heroMark).toBeVisible();
    await expect(heroMark).toHaveAttribute('width', '72');
    await expect(heroMark).toHaveAttribute('height', '72');
    // Same 3×3 structure (9 circles), labelled "Type Any Language".
    const circleCount = await heroMark.locator('circle').count();
    expect(circleCount).toBe(9);
    await expect(heroMark).toHaveAttribute('aria-label', 'Type Any Language');
    // Pulse: when pulse=true the centre circle has an <animate> child.
    // The centre circle is the 5th (index 4) of the 9.
    const centre = heroMark.locator('circle').nth(4);
    await expect(centre.locator('animate')).toHaveCount(1);
  });
});
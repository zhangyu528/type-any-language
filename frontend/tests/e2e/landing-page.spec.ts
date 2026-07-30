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

  test('Hero 不再展示独立的 BrandMark（mark 退到 AppHeader 上）', async ({
    page,
  }) => {
    await freshPage(page);
    // The hero used to host a 72px pulsing BrandMark above the demo.
    // It felt visually heavy and out of rhythm with demo → title →
    // subtitle → CTA, so it was removed. Brand identity is now
    // carried solely by the AppHeader's 22px static mark.
    //
    // Assert: the hero section contains NO <svg>. The header's mark
    // is the only SVG on the page (LoadingMark only renders during
    // load; BrandMark lives in the header chrome).
    const heroSvgs = await page
      .locator('section[aria-label="产品介绍"] svg')
      .count();
    expect(heroSvgs).toBe(0);
  });

  test('LoadingMark = 3×3 全矩阵 pulse（每点都参与动画）', async ({ page }) => {
    // Block the catalog request so the practice page stays in its
    // "loading" state long enough to assert against the rendered
    // LoadingMark. We never resolve the route — the loading UI stays.
    await page.route('**/api/content/catalog', async () => {
      // Hold the request open until the test ends.
      await new Promise(() => {});
    });
    // Use waitUntil: 'commit' so the page navigates but we don't wait
    // for the catalog to finish loading.
    await page.goto('/', { waitUntil: 'commit' });
    // The loading state should be rendered. LoadingMark is a SVG with
    // 9 circles, each carrying an <animate> child (every dot pulses,
    // unlike BrandMark where only the centre pulses).
    const loadingMark = page
      .locator('.practice--loading svg, .translation--loading svg')
      .first();
    await expect(loadingMark).toBeVisible();
    const circleCount = await loadingMark.locator('circle').count();
    expect(circleCount).toBe(9);
    const animateCount = await loadingMark.locator('animate').count();
    expect(animateCount).toBe(9);
  });
});
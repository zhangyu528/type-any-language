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

test.describe('LandingPage — Hero CTA + Footer', () => {
  test('未登录：看到「登录后开始练习」，点击跳 /login?from=/', async ({
    page,
  }) => {
    await freshPage(page);
    const cta = page.getByRole('button', { name: /登录后开始练习/ });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/login\?from=%2F/);
  });

  test('已登录 + 无 prefs.libId：按钮文案是「开始今日练习 · {libs[0].name}」', async ({
    page,
  }) => {
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
    await page.goto('/');
    // No prefs.libId is set.
    const cta = page.getByRole('button', { name: /开始今日练习 · / });
    await expect(cta).toBeVisible();
    // Click should land on libs[0].
    await cta.click();
    await expect(page).toHaveURL(/\?lib=[a-f0-9-]+/);
  });

  test('已登录 + prefs.libId 在 catalog：按钮文案是「继续练习 · {name}」，点击进该 lib', async ({
    page,
  }) => {
    // Seed prefs.libId with the second lib's id (not libs[0]) so we
    // can distinguish "继续" from "开始今日". The catalog has 4 libs;
    // we resolve the second id at runtime via /api/content/catalog.
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
    const catalogRes = await page.request.get(
      'http://localhost:8000/api/content/catalog',
    );
    expect(catalogRes.ok()).toBeTruthy();
    const catalog = (await catalogRes.json()) as {
      libs: Array<{ id: string; name: string }>;
    };
    expect(catalog.libs.length).toBeGreaterThanOrEqual(2);
    const target = catalog.libs[1];

    await page.goto('/');
    await page.evaluate((libId) => {
      window.localStorage.setItem('prefs.libId', libId);
    }, target.id);
    await page.reload();

    const cta = page.getByRole('button', {
      name: new RegExp(`继续练习 · ${target.name}`),
    });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(
      new RegExp(`\\?lib=${target.id.replace(/-/g, '[-]')}`),
    );
  });

  test('已登录 + prefs.libId 已被 catalog 移除：fallback 到 libs[0]', async ({
    page,
  }) => {
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
    await page.goto('/');
    // Seed an obviously-stale libId; the catalog has none matching it.
    await page.evaluate(() => {
      window.localStorage.setItem(
        'prefs.libId',
        '00000000-0000-0000-0000-000000000000',
      );
    });
    await page.reload();

    const cta = page.getByRole('button', { name: /开始今日练习 · / });
    await expect(cta).toBeVisible();
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
});
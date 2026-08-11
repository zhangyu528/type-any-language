/**
 * auth-escape.spec.ts — regression test for the "stuck on /login after
 * logout" bug (2026-08-06).
 *
 * Bug: AppHeader's logout button only called `logout()` (setUser(null))
 * without navigating, so the current protected route's auth-guard kicked
 * the user onto `/login?from=<protected>`. From there:
 *   - X button read `from` via safeRedirectPath → tried to push back to
 *     `<protected>` → that route's auth-guard pushed back to /login
 *     → infinite loop.
 *   - Escape key and "新用户?立即注册" alt-link all carried the same
 *     `from` and entered the same loop.
 *
 * Fix:
 *   - AppHeader logout now navigates to `/` after `logout()`
 *     (matches SettingsTab behavior).
 *   - /login & /signup X / Escape now always route to `/`,
 *     regardless of the `from` query param.
 *
 * The scenarios below verify both escape routes on /login while the
 * user is anonymous, which is the worst part of the bug — there's no
 * way to ever leave the page in the old code.
 */
import { test, expect, type Page } from '@playwright/test';

async function freshAnonPage(page: Page) {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  // Make sure no auth cookie is set either.
  await page.context().clearCookies();
}

test.describe('登录页 escape — logout 后必须能回 landing', () => {
  test('匿名访问 /login?from=/dashboard,X 关闭按钮 → /', async ({ page }) => {
    await freshAnonPage(page);
    await page.goto('/login?from=/dashboard');

    // The close (X) button has aria-label="关闭".
    await page.getByRole('button', { name: '关闭' }).click();

    await expect(page).toHaveURL(/\/$/);
  });

  test('匿名访问 /signup?from=/dashboard,X 关闭按钮 → /', async ({ page }) => {
    await freshAnonPage(page);
    await page.goto('/signup?from=/dashboard');

    await page.getByRole('button', { name: '关闭' }).click();

    await expect(page).toHaveURL(/\/$/);
  });
});

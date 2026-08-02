/**
 * guest-practice.spec.ts — end-to-end acceptance for the
 * "Guest 练习体验" feature.
 *
 * Mirrors the 8 scenarios in
 *   frontend/docs/guest-practice-experience.md (section 6).
 *
 * Conventions:
 *   - Reset localStorage between tests so each scenario starts clean.
 *   - Use the "跳过" (skip) button to deterministically drive
 *     wrong/skipped answers regardless of sentence content.
 *   - To force a correct answer we type the full sentence into the
 *     hidden typewriter input; the per-cell matcher accepts case-
 *     insensitive matches and ignores punctuation, so this is robust.
 */

import { test, expect, type Page } from '@playwright/test';

/** Fresh anonymous context per test (no cookies, no localStorage). */
async function freshPage(page: Page) {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

/** Read the current sentence text. Waits for at least one ghost
 * cell to be rendered so we never read the empty initial state. */
async function readSentenceText(page: Page): Promise<string> {
  await page.waitForFunction(
    () => document.querySelectorAll('.cells__item .cell__ghost').length > 0,
  );
  return page.evaluate(() => {
    const cells = Array.from(
      document.querySelectorAll('.cells__item .cell__ghost'),
    );
    return cells.map((el) => (el.textContent ?? '').trim()).join(' ');
  });
}

/** Type the full sentence into the focused typewriter input.
 * Waits briefly after typing so the React commit + autoFocus for the
 * next step has a chance to settle before the next iteration reads
 * a new sentence. */
async function typeSentenceCorrectly(page: Page, sentence: string) {
  await page.evaluate(() => {
    const el = document.querySelector(
      'input.typewriter-input',
    ) as HTMLInputElement | null;
    el?.focus();
  });
  await page.keyboard.type(sentence, { delay: 12 });
  // Wait for onComplete(true) → setCurrentStep → TranslationStage
  // re-render → autoFocus setTimeout(80ms) to land on the new step.
  // 600ms is empirically enough in headed mode on this machine.
  await page.waitForTimeout(600);
}

/** Click "跳过" (skip) button — fires onComplete(false). */
async function skipCurrent(page: Page) {
  await page.getByRole('button', { name: /跳过/ }).click();
}

test.describe('Guest 练习体验 — 8 个验收场景', () => {
  test('场景 1：未登录首屏 → 直接进入练习', async ({ page }) => {
    await freshPage(page);
    // Hero CTA label should be "立即开始练习" for guests.
    const cta = page.getByRole('button', { name: /立即开始练习/ });
    await expect(cta).toBeVisible();
    await cta.click();
    // URL should jump straight to /?lib=<id>; no /login detour.
    await expect(page).toHaveURL(/\?lib=[a-f0-9-]+/);
    // No login redirect happened.
    expect(page.url()).not.toContain('/login');
    // Exercise UI rendered.
    await expect(page.locator('.translation')).toBeVisible();
  });

  test('场景 2：触发「比上一句更好」卡片', async ({ page }) => {
    await freshPage(page);
    await page.getByRole('button', { name: /立即开始练习/ }).click();
    await expect(page.locator('.translation')).toBeVisible();
    // Skip step 1 → wrong
    await skipCurrent(page);
    // Read step 2's expected sentence and type it correctly.
    const sentence = await readSentenceText(page);
    expect(sentence.length).toBeGreaterThan(0);
    await typeSentenceCorrectly(page, sentence);
    // The improved card should appear.
    await expect(
      page.getByText(/比上一句更好 · 登录后保留这份进度/),
    ).toBeVisible();
  });

  test('场景 3：触发「正确率达到 80%」卡片', async ({ page }) => {
    await freshPage(page);
    await page.getByRole('button', { name: /立即开始练习/ }).click();
    await expect(page.locator('.translation')).toBeVisible();

    // Drive 5 correct answers in a row. Per the "第 1 题不算改进"
    // rule (see 场景 9), the first answer doesn't fire the improved
    // card, so the rate threshold fires cleanly at total=5, correct=5.
    for (let i = 0; i < 5; i++) {
      const sentence = await readSentenceText(page);
      await typeSentenceCorrectly(page, sentence);
    }
    await expect(
      page.getByText(/正确率达到 80% · 登录后保留这份进度/),
    ).toBeVisible();
  });

  test('场景 4：互斥 — 触发改进卡后正确率卡不再触发', async ({ page }) => {
    await freshPage(page);
    await page.getByRole('button', { name: /立即开始练习/ }).click();
    await expect(page.locator('.translation')).toBeVisible();

    // Step 1: skip → wrong
    await skipCurrent(page);
    // Step 2: correct → triggers "改进" card
    const s2 = await readSentenceText(page);
    await typeSentenceCorrectly(page, s2);
    await expect(
      page.getByText(/比上一句更好 · 登录后保留这份进度/),
    ).toBeVisible();

    // Continue answering correctly for 5+ more steps to push the
    // cumulative rate well above 80%. The "正确率" card must NOT
    // appear because the improved card has already fired.
    for (let i = 0; i < 6; i++) {
      const sentence = await readSentenceText(page);
      await typeSentenceCorrectly(page, sentence);
    }
    await expect(
      page.getByText(/正确率达到 80% · 登录后保留这份进度/),
    ).toHaveCount(0);
  });

  test('场景 5：关闭卡片 — × 后本会话不再出现', async ({ page }) => {
    await freshPage(page);
    await page.getByRole('button', { name: /立即开始练习/ }).click();
    await expect(page.locator('.translation')).toBeVisible();

    await skipCurrent(page);
    const s2 = await readSentenceText(page);
    await typeSentenceCorrectly(page, s2);
    const card = page.getByText(/比上一句更好/);
    await expect(card).toBeVisible();

    // Dismiss.
    await page.getByRole('button', { name: /关闭提示/ }).click();
    await expect(card).toHaveCount(0);

    // Continue answering; the card must not reappear this session.
    for (let i = 0; i < 4; i++) {
      const sentence = await readSentenceText(page);
      await typeSentenceCorrectly(page, sentence);
    }
    await expect(
      page.getByText(/比上一句更好 · 登录后保留这份进度/),
    ).toHaveCount(0);
  });

  test('场景 6：登录入口 — 卡片点登录跳 /login?from=<encoded>', async ({
    page,
  }) => {
    await freshPage(page);
    await page.getByRole('button', { name: /立即开始练习/ }).click();
    await skipCurrent(page);
    const s2 = await readSentenceText(page);
    await typeSentenceCorrectly(page, s2);
    await expect(
      page.getByText(/比上一句更好 · 登录后保留这份进度/),
    ).toBeVisible();

    // Click the login link inside the card.
    await page.getByRole('button', { name: /登录以保留进度/ }).click();
    await expect(page).toHaveURL(/\/login\?from=/);
  });

  test('场景 7：键盘不冲突 — 卡片出现时 Space/Tab 仍作用于练习', async ({
    page,
  }) => {
    await freshPage(page);
    await page.getByRole('button', { name: /立即开始练习/ }).click();
    await skipCurrent(page);
    const s2 = await readSentenceText(page);
    await typeSentenceCorrectly(page, s2);
    await expect(
      page.getByText(/比上一句更好 · 登录后保留这份进度/),
    ).toBeVisible();

    // The card's "登录" / "×" buttons must NOT capture Space.
    // Pressing Space here should not dismiss the card; it should
    // be intercepted by the global keyboard handler (which plays
    // audio or no-ops when no audio_url).
    await page.keyboard.press('Space');
    await expect(
      page.getByText(/比上一句更好 · 登录后保留这份进度/),
    ).toBeVisible();
  });

  test('场景 9：第 1 题答对 — 不触发改进卡', async ({ page }) => {
    // The very first answer of a session has no "previous" answer to
    // compare against, so answering the first question correctly
    // must NOT trigger the "改进" card. It also must not block the
    // "正确率" card from firing once the rate threshold is met.
    await freshPage(page);
    await page.getByRole('button', { name: /立即开始练习/ }).click();
    await expect(page.locator('.translation')).toBeVisible();

    // Drive 5 correct answers in a row. Step 1's correct answer is
    // *not* an "improvement"; we should reach the rate threshold
    // and see the rate card.
    for (let i = 0; i < 5; i++) {
      const sentence = await readSentenceText(page);
      await typeSentenceCorrectly(page, sentence);
    }
    await expect(
      page.getByText(/比上一句更好 · 登录后保留这份进度/),
    ).toHaveCount(0);
    await expect(
      page.getByText(/正确率达到 80% · 登录后保留这份进度/),
    ).toBeVisible();
  });

  // 已登录用户场景不在本期 guest 测试范围，跳过。
  test.skip('场景 8：已登录用户 — 不出现触发卡片', async ({ page }) => {
    // Skip the auth-API realism (no test DB user); instead seed the
    // auth context by stubbing the /api/auth/me response so useAuth()
    // sees a logged-in user on the very first render.
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user',
          email: 'tester@example.com',
          username: 'tester',
        }),
      }),
    );
    await page.goto('/');

    const cta = page.getByRole('button', { name: /开始今日练习/ });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\?lib=[a-f0-9-]+/);
    await expect(page.locator('.translation')).toBeVisible();

    // Drive 8 correct answers; cards must NEVER appear for a logged-in user.
    for (let i = 0; i < 8; i++) {
      const sentence = await readSentenceText(page);
      await typeSentenceCorrectly(page, sentence);
      await page.waitForTimeout(400);
    }
    await expect(
      page.getByText(/比上一句更好 · 登录后保留这份进度/),
    ).toHaveCount(0);
    await expect(
      page.getByText(/正确率达到 80% · 登录后保留这份进度/),
    ).toHaveCount(0);
  });
});
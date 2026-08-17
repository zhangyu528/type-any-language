/**
 * signup-flows.spec.ts — E2E 覆盖两种注册入口，验证「注册 → 落地欢迎页 →
 * 自动加课到「我的课程」」整条闭环。
 *
 * 两种 flow：
 *   1) 选词库注册(lib-specific)：
 *       landing 点首张词库卡「开始读 →」→ 未登录弹 signup(带 libName)
 *       → 注册成功落 /dashboard?section=practice&lib=<UUID>&welcome=1
 *       → 欢迎页显示「你即将开始《X》」+ 主按钮「开始《X》 →」
 *       → 后台 autoEnroll 把该课加入「我的课程」(乐观 + POST)，点
 *         「开始《X》」进 /practice?lib=<UUID>，回主页「我的课程」含该课。
 *   2) 通用注册(generic)：
 *       AppHeader「注册 →」→ 注册成功落 /dashboard?welcome=1
 *       → 欢迎页主按钮「进入主页 →」→ 进主页「我的课程」为空态。
 *
 * 全部后端用 page.route mock(不依赖真实后端 / docker)：
 *   - /api/auth/me   : 注册前 401(匿名)，注册后返回 user
 *   - /api/auth/signup: 标记 signedUp=true，返回新 user
 *   - /api/content/catalog: 返回 2 个词库(首张 = LIB_ID)
 *   - /api/dashboard : enrolled_lib_ids 在 enroll POST 之后才含 LIB_ID
 *   - /api/courses/<id>/enroll: 204，标记 enrolled=true
 *
 * 运行：cd frontend && npx playwright test tests/e2e/signup-flows.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

const LIB_ID = '11111111-1111-1111-1111-111111111111';
const LIB_NAME = '晨读英语';
const USER_EMAIL = 'newuser@example.com';
const USER_PASSWORD = 'password123';
const USER = {
  id: 'user-1',
  email: USER_EMAIL,
  display_name: '新同学',
  created_at: '2026-08-17T08:00:00.000Z',
};

interface MockState {
  signedUp: boolean;
  enrolled: boolean;
  enrollCalls: number;
}

function buildSnapshot(enrolled: string[]) {
  return {
    user: USER,
    continue: {
      session_id: null,
      lib_id: null,
      lesson_index: null,
      current_sentence_position: 0,
      sentences_attempted: 0,
      preview: '',
      is_unfinished: false,
    },
    daily_goal: { target: 5, today_count: 0, today_date: '2026-08-17', pct: 0, completed: false },
    streak: { current: 0, longest: 0, today_done: false, active_days: [] as string[] },
    calendar: [] as unknown[],
    monthly_goal: { target: 100, current: 0, year_month: '2026-08', achieved: false, on_track: false },
    progress: {},
    preferred_hour: null,
    has_any_activity: false,
    review_due_count: 0,
    enrolled_lib_ids: enrolled,
    lifetime: null,
    generated_at: '2026-08-17T08:00:00.000Z',
  };
}

async function installMocks(page: Page): Promise<MockState> {
  const state: MockState = { signedUp: false, enrolled: false, enrollCalls: 0 };

  // /api/auth/me — 注册前匿名(401)，注册后返回已登录 user。
  await page.route('**/api/auth/me', (route) =>
    route.fulfill(
      state.signedUp
        ? { status: 200, contentType: 'application/json', body: JSON.stringify({ user: USER }) }
        : { status: 401, body: '' },
    ),
  );

  // /api/auth/signup — 标记已注册，返回新 user(带 display_name)。
  await page.route('**/api/auth/signup', (route) => {
    state.signedUp = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(USER),
    });
  });

  // /api/content/catalog — 返回 2 个词库，首张即 LIB_ID。
  await page.route('**/api/content/catalog', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        libs: [
          {
            id: LIB_ID,
            name: LIB_NAME,
            level: 'A1',
            word_count: 50,
            sentence_count: 30,
            description: '每天一句',
            course_type: 'vocab',
            accent: 'blue',
            is_published: true,
          },
          {
            id: '22222222-2222-2222-2222-222222222222',
            name: '商务英语',
            level: 'B1',
            word_count: 80,
            sentence_count: 40,
            course_type: 'vocab',
            accent: 'green',
            is_published: true,
          },
        ],
        difficulties_by_lib: {},
        defaults: { difficulty: 'A1', bucket_target_size: 20 },
      }),
    }),
  );

  // /api/dashboard — enroll POST 之前返回空 enrolled，之后才含 LIB_ID。
  await page.route('**/api/dashboard', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildSnapshot(state.enrolled ? [LIB_ID] : [])),
    }),
  );

  // /api/courses/<id>/enroll — 记录 POST 次数并标记 enrolled。
  await page.route('**/api/courses/*/enroll', (route) => {
    if (route.request().method() === 'POST') {
      state.enrolled = true;
      state.enrollCalls += 1;
    }
    return route.fulfill({ status: 204, body: '' });
  });

  return state;
}

/** 走完 signup 两步(email → password)，并等到成功浮层出现。 */
async function fillSignup(page: Page) {
  const email = page.locator('input[name="email"]');
  await expect(email).toBeVisible();
  await email.fill(USER_EMAIL);
  await email.press('Enter');

  const pw = page.locator('input[name="password"]');
  await expect(pw).toBeVisible();
  await pw.fill(USER_PASSWORD);
  await pw.press('Enter');

  await expect(page.getByTestId('auth-success')).toBeVisible();
}

test.describe('两种注册入口', () => {
  test('选词库注册：点词库卡 → 注册 → 带 lib 的欢迎页 → 自动加课到「我的课程」', async ({
    page,
  }) => {
    const state = await installMocks(page);
    await page.goto('/');

    // 1) landing 首张词库卡「开始读 →」→ 弹 signup(带入词库名)
    const firstLibBtn = page.getByRole('button', { name: '开始读 →' }).first();
    await expect(firstLibBtn).toBeVisible();
    await firstLibBtn.click();

    // 注册弹窗显示「注册后开始《X》」上下文条
    await expect(page.getByText(/注册后开始《晨读英语》/)).toBeVisible();

    // 2) 填邮箱 + 密码完成注册
    await fillSignup(page);

    // 3) 注册成功落 dashboard，URL 带 lib + welcome=1
    await expect(page).toHaveURL(/\/dashboard\?.*lib=/);
    await expect(page).toHaveURL(/welcome=1/);

    // 4) 欢迎页(选词库专用)：胶囊 + 主按钮「开始《X》 →」
    const welcome = page.getByRole('region', { name: '欢迎' });
    await expect(welcome).toBeVisible();
    await expect(welcome.getByText('你即将开始')).toBeVisible();
    const startBtn = welcome.getByRole('button', { name: `开始《${LIB_NAME}》 →` });
    await expect(startBtn).toBeVisible();

    // 5) 后台 autoEnroll 已把课加入(乐观态 + POST enroll)
    await expect.poll(() => state.enrollCalls).toBeGreaterThan(0);

    // 6) 点「开始《X》」→ 进入主页(概览分区),不跳练习页
    await startBtn.click();
    await expect(page).not.toHaveURL(/\/practice/);
    await expect(page).toHaveURL(/\/dashboard/);
    // 引导页已关闭(进入主页)
    await expect(page.getByRole('region', { name: '欢迎' })).toHaveCount(0);

    // 7) 回主页，确认「我的课程」已含该课
    await page.goto('/dashboard');
    const courseCard = page.getByRole('button', {
      name: new RegExp(`把《${LIB_NAME}》设为当前课程`),
    });
    await expect(courseCard).toBeVisible();
  });

  test('通用注册：点 AppHeader「注册」→ 注册 → 欢迎页 → 进入主页「我的课程」为空', async ({
    page,
  }) => {
    const state = await installMocks(page);
    await page.goto('/');

    // 1) AppHeader「注册 →」
    await page.getByRole('button', { name: '注册' }).click();

    // 2) 完成注册(通用 flow 不带 libName，无「注册后开始《X》」上下文)
    await fillSignup(page);
    await expect(page.getByText(/注册后开始《/)).toHaveCount(0);

    // 3) 落地 /dashboard?welcome=1(无 lib)
    await expect(page).toHaveURL(/\/dashboard\?.*welcome=1/);
    await expect(page).not.toHaveURL(/lib=/);

    // 4) 欢迎页通用态：主按钮「进入主页 →」
    const welcome = page.getByRole('region', { name: '欢迎' });
    await expect(welcome).toBeVisible();
    const enterBtn = welcome.getByRole('button', { name: '进入主页 →' });
    await expect(enterBtn).toBeVisible();

    // 5) 进入主页，「我的课程」为空态
    await enterBtn.click();
    await expect(page.getByText('还没有课程，去添加 →')).toBeVisible();

    // 6) 通用注册不应触发任何加课
    expect(state.enrollCalls).toBe(0);
  });
});

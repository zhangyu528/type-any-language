/**
 * landing.perf.spec.ts — 性能 baseline 测试 (prod 模式)
 *
 * 跑 CI 每次,超阈值 PR 失败。
 *
 * 阈值基于 "good" Web Vitals 评分 (prod 实际值,非 dev 估算):
 *   - LCP  < 2.5s
 *   - CLS  < 0.1
 *   - FCP  < 1.8s
 *   - FPS  >= 55  (p95, 4s 滚动测试)
 *   - Long Task > 50ms = 0
 *
 * CI 跑法:
 *   E2E_PROD=1 npm test landing.perf.spec.ts
 *   (或 npm run test:perf 自动 build + 跑 prod)
 *
 * dev 模式不要跑这套 spec —— dev 的 HMR / source maps / DevTools 钩子
 * 把 LCP / FPS 拉高 2-3 倍,数字完全失真。本地想看 dev 粗略基线,可手动
 * E2E_PROD=0 npm test landing.perf.spec.ts,但不据此报警。
 *
 * 测什么:
 *   1. Web Vitals (LCP / CLS / FCP)   — 用户感知
 *   2. 滚动 FPS (4s 内 5 个 section)   — 动画健康
 *   3. Long Task (主线程 > 50ms)       — 找卡顿源
 *
 * 不测什么:
 *   - Bundle size (size-limit 工具管,见 package.json)
 *   - WebGL 内部 (Spector.js 管,按需用)
 *
 * 用 PerformanceObserver API 直接拿,不上 web-vitals npm(轻量)。
 */

import { test, expect, type Page } from '@playwright/test';

const THRESHOLDS = {
  lcp: 2500,        // ms, prod "good" 阈值
  cls: 0.1,
  fcp: 1800,        // ms, FCP 略低于 LCP
  fps: 55,          // p95 帧率下限,prod 应接近 60
} as const;

async function freshPage(page: Page) {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

test.describe('Landing performance', () => {
  test('Web Vitals (LCP / CLS / FCP) within thresholds', async ({ page }) => {
    await freshPage(page);
    await page.waitForLoadState('networkidle');

    const vitals = await page.evaluate(
      () =>
        new Promise<{ lcp: number; cls: number; fcp: number }>((resolve) => {
          let lcp = 0;
          let cls = 0;
          let fcp = 0;
          // 给浏览器 1.5s 抓 LCP/CLS(用户滚动后可能触发新的 LCP 元素)
          const finalize = setTimeout(() => resolve({ lcp, cls, fcp }), 1500);

          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              if (e.entryType === 'largest-contentful-paint') {
                lcp = e.startTime;
              }
            }
          }).observe({ type: 'largest-contentful-paint', buffered: true });

          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              // hadRecentInput 表示 500ms 内的输入触发的 shift(用户主动行为),
              // 排除掉(CLS 只算用户感知不到的布局抖动)。
              if (!(e as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput) {
                cls += (e as PerformanceEntry & { value: number }).value;
              }
            }
          }).observe({ type: 'layout-shift', buffered: true });

          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              if (e.name === 'first-contentful-paint') {
                fcp = e.startTime;
              }
            }
          }).observe({ type: 'paint', buffered: true });

          // cleanup(防止 promise 挂死)
          void finalize;
        })
    );

    console.log(
      `[perf] LCP=${vitals.lcp.toFixed(0)}ms CLS=${vitals.cls.toFixed(4)} FCP=${vitals.fcp.toFixed(0)}ms`
    );
    expect(vitals.lcp).toBeLessThan(THRESHOLDS.lcp);
    expect(vitals.cls).toBeLessThan(THRESHOLDS.cls);
    expect(vitals.fcp).toBeLessThan(THRESHOLDS.fcp);
  });

  test('scroll through 5 sections at >= 50 FPS (p95)', async ({ page }) => {
    await freshPage(page);
    await page.waitForLoadState('networkidle');

    // rAF 测 FPS,同时模拟滚动触发所有 section 的 IntersectionObserver / 动画。
    // 4s 滚动测试 = 平滑节奏(每 400ms 滚一段)。
    const fps = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const frameTimes: number[] = [];
          let last = performance.now();
          let running = true;
          const totalDuration = 4000;
          const stepCount = 10;
          const startTime = performance.now();

          const tick = () => {
            const now = performance.now();
            frameTimes.push(now - last);
            last = now;
            if (running && now - startTime < totalDuration) {
              requestAnimationFrame(tick);
            } else {
              // p95 帧时间(取 95% 分位),反算 FPS
              const sorted = [...frameTimes].sort((a, b) => a - b);
              const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 16;
              resolve(1000 / p95);
            }
          };
          requestAnimationFrame(tick);

          // 模拟滚动 — 10 步扫到页面底部
          for (let i = 1; i <= stepCount; i += 1) {
            setTimeout(() => {
              window.scrollTo({
                top: (i / stepCount) * document.body.scrollHeight,
                behavior: 'auto',
              });
            }, (i * totalDuration) / stepCount);
          }
          // 测完停掉
          setTimeout(() => {
            running = false;
          }, totalDuration + 200);
        })
    );

    console.log(`[perf] p95 FPS = ${fps.toFixed(1)}`);
    expect(fps).toBeGreaterThanOrEqual(THRESHOLDS.fps);
  });

  test('no main-thread long task > 50ms during load', async ({ page }) => {
    await freshPage(page);
    await page.waitForLoadState('networkidle');

    // 监听 3s 内 long task。buffered: true 让首屏前发生的事件也抓到。
    const longTasks = await page.evaluate(
      () =>
        new Promise<
          Array<{ duration: number; startTime: number; name: string }>
        >((resolve) => {
          const tasks: Array<{
            duration: number;
            startTime: number;
            name: string;
          }> = [];
          const po = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              if (e.duration > 50) {
                tasks.push({
                  duration: e.duration,
                  startTime: e.startTime,
                  name: e.name,
                });
              }
            }
          });
          po.observe({ type: 'longtask', buffered: true });
          setTimeout(() => resolve(tasks), 3000);
        })
    );

    if (longTasks.length > 0) {
      console.log(
        `[perf] ${longTasks.length} long task(s):`,
        longTasks
          .map(
            (t) =>
              `${t.duration.toFixed(0)}ms (${t.name}) @ ${t.startTime.toFixed(0)}ms`
          )
          .join(', ')
      );
    }
    expect(longTasks.length).toBe(0);
  });
});

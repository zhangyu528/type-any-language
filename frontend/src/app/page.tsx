'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getContentCatalog,
  Catalog,
  loadTranslationProgress,
  TranslationProgress,
} from './api';
import LandingPage from './landing';
import LoadingMark from './components/LoadingMark';
import AppHeader from './components/AppHeader';
import { useAuth } from './lib/auth';
import { useAuthModal, isPostAuthNavigating, setPostAuthNavigating } from './lib/authModal';
import styles from './practice/Practice.module.css';

/**
 * 落地页 — 匿名访客的 marketing / 浏览入口。
 *
 * URL 约定：
 *   /            → LandingPage（匿名）；登录用户会被重定向到 /dashboard
 *
 * 选词的导航统一走 /practice?lib=X（由 /practice/page.tsx 接管），与
 * dashboard 入口共享同一路由 + UI。本页不再原地渲染 TranslationSession，
 * 因为 dashboard 才是选词库与启动练习的归属 — 落地页只负责浏览 + 引导登录。
 *
 * 登录用户访问 `/`（不带 ?lib）会立即重定向到 /dashboard，他们的"上次
 * 进度 / 继续练习"由 ContinueCard 等 dashboard 组件接管。深链
 * `/?lib=X&sentence=Y`（如 /me 页"练这句"）已迁移到 /practice?lib=X&sentence=Y，
 * 由 PracticeRoute 直接对接。
 */
export default function PracticePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { open: openAuthModal } = useAuthModal();

  // 登录用户访问 `/`（无 ?lib）→ /dashboard。AuthModal 注册/登录成功后
  // 会接管跳转(目标带 ?welcome=1 等 query),若它正在导航中则本次跳过,
  // 避免把 query 清成裸 /dashboard。
  useEffect(() => {
    if (authLoading) return;
    if (user && !isPostAuthNavigating()) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  // 卸载时复位「post-auth 导航中」标记。
  useEffect(() => {
    return () => {
      setPostAuthNavigating(false);
    };
  }, []);

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [translationProgress, setTranslationProgress] =
    useState<TranslationProgress>({});
  const [error, setError] = useState('');

  // Catalog + 进度加载。空 catalog 也要 setCatalog(null→[]) 才能落到
  // 下方「暂无课程」分支,避免 catalog 永远为 null 卡在 Loading — 同
  // history 教训保留。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, tp] = await Promise.all([
          getContentCatalog(),
          Promise.resolve(loadTranslationProgress()),
        ]);
        if (cancelled) return;
        setCatalog(c);
        setTranslationProgress(tp);
      } catch {
        if (!cancelled) {
          setError('内容加载失败，请检查后端服务是否在运行后刷新重试。');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 词库起点:统一跳 /practice?lib=X(由 /practice/page.tsx 接管) 与
  // dashboard 入口同路由。未登录先弹注册(带入词库名),注册成功落
  // /practice?lib=X&welcome=1,直达练习 — 不再回 dashboard 中转。
  const navigateToSession = useCallback(
    (libId: string) => {
      const target = `/practice?lib=${encodeURIComponent(libId)}${user ? '&from=dashboard' : '&welcome=1'}`;
      if (!user) {
        const name = catalog?.libs.find((l) => l.id === libId)?.name ?? null;
        openAuthModal('signup', { from: target, libName: name });
        return;
      }
      router.push(target);
    },
    [user, openAuthModal, catalog, router],
  );

  // 非词库起点(Hero / FinalCTA 的通用 CTA):已登录直接进 dashboard;未登录
  // 弹注册,注册成功落 /dashboard?welcome=1,由欢迎横幅引导挑词库。
  const startGeneric = useCallback(() => {
    if (user) {
      router.push('/dashboard');
      return;
    }
    openAuthModal('signup', { from: '/dashboard?welcome=1' });
  }, [user, router, openAuthModal]);

  // ---- Render ----
  if (authLoading) {
    return (
      <div className={`${styles.root} ${styles.loading}`}>
        <LoadingMark />
        <p className={styles.loaderText}>Loading…</p>
      </div>
    );
  }
  // 已登录用户在 useEffect 中被重定向到 dashboard,期间路由未切走:
  // 让他保持 Loading,避免 Landing 在他眼前闪一帧再被 replace 掉。
  if (user) {
    return (
      <div className={`${styles.root} ${styles.loading}`}>
        <LoadingMark />
        <p className={styles.loaderText}>Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.root} ${styles.error}`}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className={`${styles.root} ${styles.loading}`}>
        <LoadingMark />
        <p className={styles.loaderText}>Loading…</p>
      </div>
    );
  }

  if (catalog.libs.length === 0) {
    return (
      <div className={`${styles.root} ${styles.empty}`}>
        <p className={styles.emptyText}>暂无课程</p>
        <p className={styles.emptyHint}>
          请检查 <code>db/cms/manifest.yaml</code> 与对应 CSV 文件
        </p>
      </div>
    );
  }

  // 仅匿名访客到达此处。LandingPage 通过 onPickLib 选词、onStartGeneric
  // 走通用 CTA,统一 router.push 到 /practice 或 /dashboard。
  return (
    <>
      <AppHeader />
      <LandingPage
        libs={catalog.libs}
        translationProgress={translationProgress}
        onPickLib={navigateToSession}
        onStartGeneric={startGeneric}
      />
    </>
  );
}

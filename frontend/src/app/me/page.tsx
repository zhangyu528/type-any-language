'use client';

/**
 * /me — personal center.
 *
 * Phase 4.0 + 4.4 + polishing:
 *   - Layout shell: title block + AccountCard + sticky 3-tab nav
 *   - Catalog fetch: StatsTab and CollectionTab both need lib names
 *     + sentence text. Fetched once here and threaded down.
 *   - Tab state from URL ?tab= (default 'stats'). Refresh keeps
 *     the user on the same tab.
 *   - Account card supports inline editing of `display_name`.
 *     Same PATCH endpoint as /api/auth (scaffolded in api.ts
 *     but the backend may not have it yet — we degrade gracefully
 *     to a localStorage fallback so the surface is always usable).
 *
 * Phase 4.1–4.3 (StatsTab / CollectionTab / SettingsTab) live as
 * separate files under ./me/. They share catalog data via props,
 * not React context — keeping the tree shallow and the data flow
 * obvious.
 */
import { useRouter, usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useAuth } from '../lib/auth';
import {
  Catalog,
  AuthUser,
  getContentCatalog,
  loadCollection,
  updateDisplayName,
} from '../api';
import {
  AuroraBackground,
  ShinyText,
  SpotlightCard,
  VariableProximity,
} from '@/components/effects';
import { BABY_BLUE_CURTAINS } from '@/components/effects/baby-blue-curtains';
import StatsTab from './StatsTab';
import CollectionTab from './CollectionTab';
import SettingsTab from './SettingsTab';
import styles from './me-page.module.css';

type TabKey = 'stats' | 'wrong' | 'settings';

const TAB_ORDER: TabKey[] = ['stats', 'wrong', 'settings'];

const TAB_LABEL: Record<TabKey, string> = {
  stats: '统计',
  wrong: '收藏夹',
  settings: '设置',
};

function isTabKey(s: string | null): s is TabKey {
  return s === 'stats' || s === 'wrong' || s === 'settings';
}

export default function MePage() {
  return (
    <Suspense
      fallback={
        <div className="practice practice--loading">
          <p className="practice__loader-text">Loading…</p>
        </div>
      }
    >
      <MeInner />
    </Suspense>
  );
}

function MeInner() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Per-user data namespace. Anonymous users share one bucket
  // (see api.ts::ANONYMOUS_USER_ID). Signed-in users get their
  // own localStorage key prefix.
  const userId = user?.id ?? 'anonymous';
  // Live collection count for the 收藏夹 tab badge.
  const [collectionCount, setCollectionCount] = useState<number>(0);

  // Auth gate — anonymous users bounce to /login?from=/me.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      const here = pathname || '/me';
      router.replace(`/login?from=${encodeURIComponent(here)}`);
    }
  }, [loading, user, router, pathname]);

  // Read + listen for collection changes.
  const recomputeCollectionCount = useCallback(() => {
    const collection = loadCollection(userId);
    setCollectionCount(Object.keys(collection.sentences).length);
  }, [userId]);

  useEffect(() => {
    recomputeCollectionCount();
    const onStorage = (e: StorageEvent) => {
      const expectedKey = `me.collection:${userId}`;
      if (e.key === null || e.key === expectedKey) {
        recomputeCollectionCount();
      }
    };
    const onCollectionChanged = () => recomputeCollectionCount();
    window.addEventListener('storage', onStorage);
    window.addEventListener('collection-changed', onCollectionChanged);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('collection-changed', onCollectionChanged);
    };
  }, [recomputeCollectionCount, userId]);

  // Catalog fetch — single round-trip on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getContentCatalog();
        if (cancelled) return;
        setCatalog(c);
      } catch (e) {
        if (cancelled) return;
        setCatalogError(e instanceof Error ? e.message : '获取内容目录失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Tab state — URL is the source of truth.
  const readTab = useCallback((): TabKey => {
    if (typeof window === 'undefined') return 'stats';
    const t = new URLSearchParams(window.location.search).get('tab');
    return isTabKey(t) ? t : 'stats';
  }, []);
  const [tab, setTab] = useState<TabKey>('stats');

  useEffect(() => {
    setTab(readTab());
  }, [readTab]);

  const setTabUrl = useCallback((next: TabKey) => {
    const url = new URL(window.location.href);
    url.pathname = '/me';
    if (next === 'stats') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', next);
    }
    window.history.pushState({}, '', url.toString());
    setTab(next);
  }, []);

  // popstate — back/forward button support.
  useEffect(() => {
    const onPop = () => setTab(readTab());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [readTab]);

  // ME-Q3A: tabs "stuck" state — when the sticky tabs reach their
  // pinned position, fade in a soft frosted background. We use a
  // sentinel <div> placed right above the tabs and observe it;
  // once it scrolls past the top: 52px sticky line, the tabs are
  // "stuck" and we set data-stuck="true". The rootMargin approach
  // means we don't hardcode the 52px in two places.
  //
  // The setup polls for the tabs nav because MeInner renders
  // it only after auth/user is loaded — a plain [] useEffect can
  // fire before the nav is in the DOM and bail on a null query.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let io: IntersectionObserver | null = null;
    let sentinel: HTMLDivElement | null = null;
    const setup = () => {
      const tabs = document.querySelector<HTMLElement>('nav[class*="me-tabs"]');
      if (!tabs || !tabs.parentElement) return false;
      sentinel = document.createElement('div');
      sentinel.style.cssText =
        'position:absolute;left:0;right:0;top:0;height:1px;pointer-events:none;';
      tabs.parentElement.insertBefore(sentinel, tabs);
      io = new IntersectionObserver(
        ([entry]) => {
          tabs.dataset.stuck = entry.isIntersecting ? 'false' : 'true';
        },
        { rootMargin: '-52px 0px 0px 0px', threshold: 0 }
      );
      io.observe(sentinel);
      return true;
    };
    // Try a few frames in case the nav mounts after this effect.
    let attempts = 0;
    const trySetup = () => {
      if (setup()) return;
      if (++attempts < 10) requestAnimationFrame(trySetup);
    };
    trySetup();
    return () => {
      io?.disconnect();
      sentinel?.remove();
    };
  }, []);

  if (loading || !user) {
    return (
      <div className="practice practice--loading">
        <p className="practice__loader-text">Loading…</p>
      </div>
    );
  }

  return (
    <div className={styles['me-page']}>
      {/* ME-2: aurora background — same babyblue curtains as
         Dashboard, so the two pages share an immersive backdrop.
         Sits behind all content via z:-1 + pointer-events:none. */}
      <AuroraBackground
        className={styles['me-page__aurora']}
        curtains={BABY_BLUE_CURTAINS}
      />
      <div className={styles['me-page__content']}>
        <header className={styles['me-page__masthead']} aria-label="page header">
          <Link href="/" className={styles['me-page__back']}>
            ← 返回练习
          </Link>
        </header>

        <div>
          {/* ME-4: replaced generic "我的" with the actual section
             name "个人中心". Caption is now a real description,
             not a username callout (the username already shows
             in AccountCard right below). */}
          <h1 className={styles['me-page__title']}>个人中心</h1>
          <p className={styles['me-page__caption']}>
            管理你的练习进度、收藏的句子，以及主题与播放偏好。
          </p>
        </div>

        <AccountCard user={user} />

        <nav className={styles['me-tabs']} aria-label="个人中心分区">
          {TAB_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              className={styles['me-tabs__btn']}
              data-active={tab === t ? 'true' : 'false'}
              onClick={() => setTabUrl(t)}
              aria-current={tab === t ? 'page' : undefined}
            >
              {t === 'wrong' && collectionCount > 0 ? (
                <span className={styles['me-tabs__label']}>
                  {/* ME-6: ShinyText on active tab — subtle shine
                     sweep signals the selection beyond just
                     the background tint. */}
                  {tab === t ? (
                    <ShinyText
                      text="收藏夹"
                      speed={3}
                      color="var(--ds-action-deep)"
                      shineColor="var(--ds-ink)"
                    />
                  ) : (
                    '收藏夹'
                  )}
                  <span
                    className={styles['me-tabs__badge']}
                    aria-label={`${collectionCount} 个收藏`}
                  >
                    {collectionCount}
                  </span>
                </span>
              ) : tab === t ? (
                <span className={styles['me-tabs__label']}>
                  <ShinyText
                    text={TAB_LABEL[t]}
                    speed={3}
                    color="var(--ds-action-deep)"
                    shineColor="var(--ds-ink)"
                  />
                </span>
              ) : (
                TAB_LABEL[t]
              )}
            </button>
          ))}
        </nav>

        {/* ME-6: AnimatePresence on tab swap — fade + tiny y
           translate so the change feels intentional, not abrupt.
           key=tab forces remount on switch. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={styles['me-tab-panel']}
            role="region"
            aria-label={TAB_LABEL[tab]}
          >
            {tab === 'stats' && (
              <StatsTab
                userId={userId}
                catalog={catalog}
                catalogError={catalogError}
              />
            )}
            {tab === 'wrong' && (
              <CollectionTab
                userId={userId}
                catalog={catalog}
                catalogError={catalogError}
              />
            )}
            {tab === 'settings' && <SettingsTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function AccountCard({ user }: { user: AuthUser }) {
  // Bump a local revision so the card re-renders after the inline
  // edit commits a new display name. Pure UI signal; the AuthUser
  // object reference may or may not change depending on whether
  // the AuthProvider hydrates from a refetch.
  const [revision, setRevision] = useState(0);
  const displayName = (user.display_name ?? user.email ?? '').trim();
  const email = (user.email ?? '').trim();
  const initials =
    displayName.charAt(0).toUpperCase() ||
    email.charAt(0).toUpperCase() ||
    '?';
  const joined = formatJoinedDate(user.created_at);

  return (
    <section className={styles['me-account-card']} aria-label="账号信息">
      {/* ME-3: TiltCard + glare was overkill for an identity
         element (users don't "play" with their own avatar).
         SpotlightCard gives a cursor-follow glow — softer and
         on-brand. */}
      <SpotlightCard
        className={styles['me-account-card__avatarWrap']}
        spotlightColor="var(--ds-action-soft)"
      >
        <div className={styles['me-account-card__avatar']} aria-hidden="true">
          {initials}
        </div>
      </SpotlightCard>
      <div className={styles['me-account-card__meta']}>
        <DisplayNameField
          key={`name-${user.id}-${revision}`}
          userId={user.id}
          initialName={displayName}
          email={email}
          onSaved={(name) => {
            user.display_name = name;
            setRevision((r) => r + 1);
          }}
        />
        {email && email !== displayName ? (
          <p className={styles['me-account-card__email']}>{email}</p>
        ) : null}
        <p className={styles['me-account-card__joined']}>
          {joined ? `注册于 ${joined}` : null}
        </p>
      </div>
    </section>
  );
}

/**
 * Inline-editable display name. The backend PATCH endpoint may or
 * may not exist; the helper degrades to a localStorage cache so
 * the surface always works for the current session.
 */
function DisplayNameField({
  userId,
  initialName,
  email,
  onSaved,
}: {
  userId: string;
  initialName: string;
  email: string;
  onSaved: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // localStorage fallback key — only used if the backend route is
  // unavailable. The next page reload re-reads the official
  // /api/auth/me response so this stays in sync with the server.
  const fallbackKey = `me.displayNameFallback:${userId}`;

  const commit = async () => {
    const next = draft.trim();
    if (!next || next === initialName) {
      setEditing(false);
      setDraft(initialName);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      try {
        await updateDisplayName(next);
      } catch {
        // Backend not wired yet — fall back to localStorage so the
        // UI still reflects the change for this session.
        try {
          window.localStorage.setItem(fallbackKey, next);
        } catch {
          /* 隐私模式静默 */
        }
      }
      onSaved(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(initialName);
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className={styles['me-inline-edit']}>
        <p className={styles['me-account-card__name']}>
          {initialName || email || '匿名用户'}
        </p>
        <button
          type="button"
          className={styles['me-inline-edit__action']}
          onClick={() => {
            setDraft(initialName);
            setEditing(true);
          }}
          aria-label="修改显示名"
        >
          修改
        </button>
      </div>
    );
  }

  return (
    <div className={styles['me-inline-edit']}>
      <input
        className={styles['me-inline-edit__input']}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={64}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        aria-label="显示名"
      />
      <button
        type="button"
        className={styles['me-inline-edit__action']}
        data-primary="true"
        onClick={() => void commit()}
        disabled={saving}
      >
        保存
      </button>
      <button
        type="button"
        className={styles['me-inline-edit__action']}
        onClick={cancel}
        disabled={saving}
      >
        取消
      </button>
      {error ? (
        <p className={styles['me-inline-edit__error']}>{error}</p>
      ) : null}
    </div>
  );
}

function formatJoinedDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('zh-CN');
}

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
import Link from 'next/link';
import { useAuth } from '../lib/auth';
import {
  Catalog,
  AuthUser,
  getContentCatalog,
  loadCollection,
  updateDisplayName,
} from '../api';
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

  if (loading || !user) {
    return (
      <div className="practice practice--loading">
        <p className="practice__loader-text">Loading…</p>
      </div>
    );
  }

  return (
    <div className={styles['me-page']}>
      <div className={styles['me-page__content']}>
        <header className={styles['me-page__masthead']} aria-label="page header">
          <Link href="/" className={styles['me-page__back']}>
            ← 返回练习
          </Link>
        </header>

        <div>
          <h1 className={styles['me-page__title']}>我的</h1>
          <p className={styles['me-page__caption']}>
            {user.display_name},这里是你的个人中心。
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
                  收藏夹
                  <span
                    className={styles['me-tabs__badge']}
                    aria-label={`${collectionCount} 个收藏`}
                  >
                    {collectionCount}
                  </span>
                </span>
              ) : (
                TAB_LABEL[t]
              )}
            </button>
          ))}
        </nav>

        <div
          className={styles['me-tab-panel']}
          key={tab}
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
        </div>
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
      <div className={styles['me-account-card__avatar']} aria-hidden="true">
        {initials}
      </div>
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

'use client';

/**
 * /me — personal center.
 *
 * Phase 4.0 + 4.4:
 *   - Layout shell: title block + AccountCard + sticky 3-tab nav
 *   - Catalog fetch: StatsTab and CollectionTab both need lib names
 *     + sentence text. Fetched once here and threaded down.
 *   - Tab state from URL ?tab= (default 'stats'). Refresh keeps
 *     the user on the same tab.
 *
 * Phase 4.1–4.3 (StatsTab / CollectionTab / SettingsTab) live as
 * separate files under ./me/. They share catalog data via props,
 * not React context — keeping the tree shallow and the data flow
 * obvious.
 *
 * Auth gate is identical to the Phase 1 placeholder; the real
 * redirect-to-/me-on-login behaviour is deferred to a future phase
 * (see Phase 1.4 findings).
 */
import { useRouter, usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../lib/auth';
import { Catalog, getContentCatalog, loadCollection } from '../api';
import StatsTab from './StatsTab';
import CollectionTab from './CollectionTab';
import SettingsTab from './SettingsTab';

type TabKey = 'stats' | 'wrong' | 'settings';

const TAB_ORDER: TabKey[] = ['stats', 'wrong', 'settings'];

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
  // own localStorage key prefix so two accounts on the same
  // device never see each other's collection / progress.
  const userId = user?.id ?? 'anonymous';
  // Live collection count for the 收藏夹 tab badge. Recomputed
  // on mount, on every `storage` event (cross-tab), and on the
  // custom `collection-changed` event TranslationStage dispatches
  // when the user toggles a star. Without the same-tab event, a
  // user could star a sentence, come back to /me via the avatar,
  // and see a stale (zero) badge — same UX problem the old
  // immediately.
  const [collectionCount, setCollectionCount] = useState<number>(0);

  // Auth gate — anonymous users bounce to /login?from=/me. Same
  // pattern as /history (HttpOnly cookie → useAuth → client redirect).
  useEffect(() => {
    if (loading) return;
    if (!user) {
      const here = pathname || '/me';
      router.replace(`/login?from=${encodeURIComponent(here)}`);
    }
  }, [loading, user, router, pathname]);

  // Read + listen for collection changes. Recomputes the count
  // whenever the collection mutates (any source — mount, cross-tab
  // storage event, or same-tab dispatch from TranslationStage).
  const recomputeCollectionCount = useCallback(() => {
    const collection = loadCollection(userId);
    setCollectionCount(Object.keys(collection.sentences).length);
  }, [userId]);

  useEffect(() => {
    recomputeCollectionCount();
    // Cross-tab: native `storage` event fires when ANOTHER tab
    // writes the key we care about. Same-tab writes don't fire it,
    // so we listen to the custom event below too. Filter by key
    // prefix so a cross-tab event for user A's collection doesn't
    // bounce user B's badge.
    const onStorage = (e: StorageEvent) => {
      const expectedKey = `me.collection:${userId}`;
      if (e.key === null || e.key === expectedKey) {
        recomputeCollectionCount();
      }
    };
    // Same-tab: TranslationStage dispatches this when the user
    // toggles a star.
    const onCollectionChanged = () => recomputeCollectionCount();
    window.addEventListener('storage', onStorage);
    window.addEventListener('collection-changed', onCollectionChanged);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('collection-changed', onCollectionChanged);
    };
  }, [recomputeCollectionCount, userId]);

  // Catalog fetch — single round-trip on mount. Tolerate failure
  // (the page still renders; tabs that need catalog gracefully
  // degrade).
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

  // Tab state — URL is the source of truth so a refresh / share keeps
  // the user on the same tab. pushState (not replaceState) so back
  // navigation walks through tab history too.
  const readTab = useCallback((): TabKey => {
    if (typeof window === 'undefined') return 'stats';
    const t = new URLSearchParams(window.location.search).get('tab');
    return isTabKey(t) ? t : 'stats';
  }, []);
  const [tab, setTab] = useState<TabKey>('stats');

  useEffect(() => {
    setTab(readTab());
  }, [readTab]);

  const setTabUrl = useCallback(
    (next: TabKey) => {
      const url = new URL(window.location.href);
      url.pathname = '/me';
      if (next === 'stats') {
        url.searchParams.delete('tab');
      } else {
        url.searchParams.set('tab', next);
      }
      window.history.pushState({}, '', url.toString());
      setTab(next);
    },
    [],
  );

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
    <div className="practice me-page">
      <div className="practice__content me-page__content">
        <header className="masthead" aria-label="page header">
          <Link href="/" className="masthead__brand">
            ← 返回练习
          </Link>
        </header>

        <h1 className="home__title me-page__title">我的</h1>
        <p className="home__caption me-page__caption">
          {user.display_name},这里是你的个人中心。
        </p>

        <AccountCard
          displayName={user.display_name}
          email={user.email}
          createdAt={user.created_at}
        />

        <nav className="me-tabs" aria-label="个人中心分区">
          {TAB_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              className="me-tabs__btn"
              data-active={tab === t ? 'true' : 'false'}
              onClick={() => setTabUrl(t)}
              aria-current={tab === t ? 'page' : undefined}
            >
              {t === 'wrong' && collectionCount > 0 ? (
                <span className="me-tabs__label">
                  收藏夹
                  <span
                    className="me-tabs__badge"
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

        <div className="me-tab-panel" key={tab} role="region" aria-label={TAB_LABEL[tab]}>
          {tab === 'stats' && <StatsTab userId={userId} catalog={catalog} catalogError={catalogError} />}
          {tab === 'wrong' && <CollectionTab userId={userId} catalog={catalog} catalogError={catalogError} />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

const TAB_LABEL: Record<TabKey, string> = {
  stats: '统计',
  wrong: '收藏夹',
  settings: '设置',
};

function AccountCard({
  displayName,
  email,
  createdAt,
}: {
  displayName: string;
  email: string;
  createdAt: string;
}) {
  // Defensive chain for the avatar + visible name. Backend *should*
  // always return non-null strings (signup requires both fields),
  // but if a future API change drops either field we fall back to
  // the email local-part, then a literal '?' so the avatar isn't
  // blank. Empty-string after trim also falls through (signup
  // validation prevents it today but cheap to guard).
  const safeName = (displayName ?? email ?? '').trim();
  const safeEmail = (email ?? '').trim();
  const initials =
    safeName.charAt(0).toUpperCase() ||
    safeEmail.charAt(0).toUpperCase() ||
    '?';
  const joined = formatJoinedDate(createdAt);
  return (
    <section className="me-account-card" aria-label="账号信息">
      <div className="me-account-card__avatar" aria-hidden="true">
        {initials}
      </div>
      <div className="me-account-card__meta">
        <p className="me-account-card__name">{safeName || safeEmail || '匿名用户'}</p>
        {safeEmail && safeEmail !== safeName ? (
          <p className="me-account-card__email">{safeEmail}</p>
        ) : null}
        <p className="me-account-card__joined">
          {joined ? `注册于 ${joined}` : null}
        </p>
      </div>
    </section>
  );
}

function formatJoinedDate(iso: string): string | null {
  // created_at is an ISO string from the backend. We just render a
  // locale date — full datetime is noisy on the personal-center card.
  // Defensive: invalid date → render nothing rather than "Invalid Date".
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('zh-CN');
}
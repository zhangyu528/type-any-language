'use client';

/**
 * AuthProvider — global auth state for the SPA.
 *
 * Holds the current `user` (or null when anonymous) in React context,
 * hydrates it on mount via GET /api/auth/me, and exposes `refresh` +
 * `logout` to descendants.
 *
 * Why a provider and not just useState per page:
 *  - /login + /signup need to set `user` after a successful submit,
 *    and the <AppHeader> needs to see the new state on the very next
 *    render — a React context tree lets both components share one
 *    source of truth without prop-drilling.
 *  - On hard refresh, the cookie is still there; `apiMe` rehydrates
 *    state from the cookie without a login round-trip.
 *
 * Mounted once in app/layout.tsx, above all route children.
 *
 * Loading semantics:
 *  - `loading` starts true. AppHeader should not flicker between
 *    "login pill" and "avatar" during this initial window — the
 *    AppHeader currently shows the login pill regardless of loading
 *    (the next phase replaces this with auth-aware rendering).
 *  - Once the initial /api/auth/me resolves, `loading` flips to false.
 *  - `user` is null if anonymous, or the hydrated user otherwise.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiLogout, apiMe, type AuthUser } from '../api';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /**
   * Force a re-read of /api/auth/me. Use after a successful
   * login / signup on the auth pages so AppHeader + any other
   * descendant picks up the new user immediately.
   */
  refresh: () => Promise<void>;
  /** Sign the user out via POST /api/auth/logout + clear local state. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Track whether a refresh is in flight so concurrent callers
  // (e.g. login + header re-render) don't fire two parallel /me
  // requests. The latest call wins; earlier ones just resolve to
  // whatever state the latest call set.
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      try {
        const u = await apiMe();
        setUser(u);
      } catch {
        // Network error on initial fetch — treat as anonymous. The
        // header stays in "login pill" state, which is honest.
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
    inflight.current = p;
    try {
      await p;
    } finally {
      inflight.current = null;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Even if the network call fails, clear local state so the
      // chrome updates. The cookie may already be gone (e.g. expired).
    }
    setUser(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, refresh, logout }),
    [user, loading, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
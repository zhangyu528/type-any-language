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
  // Guards against a STALE /me result clobbering a newer one. The
  // initial mount hydration (R1, runs with NO session cookie → null)
  // and a post-login refresh (R2, runs WITH the cookie → user) can
  // overlap — e.g. the user logs in while R1 is still in flight, or
  // React Strict Mode double-invokes the mount effect. The old code
  // used an `inflight` guard that made R2 *return R1's promise*,
  // so R2 resolved to R1's null and the dashboard got stuck on its
  // loading screen until a hard refresh re-read the cookie. Worse,
  // even a fresh R2 could be clobbered if R1 (slower backend) resolved
  // AFTER R2. Fix: stamp every refresh with a monotonically increasing
  // id and apply the result only if it's still the latest. The latest
  // call always wins; superseded ones are ignored.
  const latestAuthReq = useRef(0);

  const refresh = useCallback(async () => {
    const reqId = ++latestAuthReq.current;
    try {
      const u = await apiMe();
      if (reqId !== latestAuthReq.current) return; // superseded by a newer refresh
      setUser(u);
    } catch {
      if (reqId !== latestAuthReq.current) return; // superseded — don't clobber
      // Network error on initial fetch — treat as anonymous. The
      // header stays in "login pill" state, which is honest.
      setUser(null);
    } finally {
      if (reqId === latestAuthReq.current) setLoading(false);
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
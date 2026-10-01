'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError, SessionInfo } from '@/lib/api';

interface SessionState {
  session: SessionInfo | null;
  loading: boolean;
  setSession: (s: SessionInfo | null) => void;
  /** Rejects if the server couldn't be reached, so the caller can say so instead of implying success. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({ session: null, loading: true, setSession: () => {}, signOut: async () => {} });

export const homeFor = (s: SessionInfo) => (s.role === 'agent' ? '/admin' : '/');
const signInFor = (role: SessionInfo['role']) => (role === 'agent' ? '/staff/login' : '/login');

/**
 * Loads the signed-in user once (GET /api/auth/me). A 401 means "signed out"; any other failure means the
 * service is unreachable, which gets its own screen instead of a misleading redirect to sign-in.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [outage, setOutage] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setOutage(null);
    api
      .me()
      .then(setSession)
      .catch((e) => {
        setSession(null);
        if (!(e instanceof ApiError && e.status === 401)) setOutage((e as Error).message);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const signOut = useCallback(async () => {
    const role = session?.role ?? 'customer';
    await api.logout(); // throws on failure: the cookie was not cleared, so the user is still signed in
    // Full navigation drops all in-memory state from the previous account.
    window.location.assign(signInFor(role));
  }, [session]);

  if (outage) {
    return (
      <div className="auth">
        <div className="card auth-card stack" role="alert">
          <h1>Service unavailable</h1>
          <p className="muted">{outage}</p>
          <button className="btn btn-primary btn-block" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  return <SessionContext.Provider value={{ session, loading, setSession, signOut }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

/** Returns the session when signed in with `role`; otherwise redirects (to that role's sign-in, or the user's own area). */
export function useRequireRole<R extends SessionInfo['role']>(role: R): Extract<SessionInfo, { role: R }> | null {
  const { session, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!session) router.replace(signInFor(role));
    else if (session.role !== role) router.replace(homeFor(session));
  }, [loading, session, role, router]);
  return !loading && session?.role === role ? (session as Extract<SessionInfo, { role: R }>) : null;
}

/** For sign-in pages: once signed in, go to your own area. */
export function useRedirectIfSignedIn() {
  const { session, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading && session) router.replace(homeFor(session));
  }, [loading, session, router]);
}

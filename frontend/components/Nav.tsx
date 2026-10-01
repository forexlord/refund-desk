'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from '@/components/Session';
import { api, Health } from '@/lib/api';

// On phones the nav becomes a bottom tab bar (icon + short label); on desktop it is a top bar (long label).
// Links follow the signed-in role: customers never see the agent area, and agents can't switch into a customer.
const CHAT = { href: '/', short: 'Chat', long: 'Help chat', icon: 'M4 5h16v11H9l-5 4z' };
const POLICY = { href: '/policy', short: 'Policy', long: 'Refund policy', icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7' };
const DASHBOARD = { href: '/admin', short: 'Queue', long: 'Review queue', icon: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z' };
const CUSTOMER_LINKS = [CHAT, POLICY];
const AUTH_PAGES = ['/login', '/staff/login', '/forgot-password', '/reset-password'];
const AGENT_LINKS = [DASHBOARD, POLICY];

export function Nav() {
  const path = usePathname();
  const { session, signOut } = useSession();
  const agentArea = session?.role === 'agent';
  const links = !session ? [] : agentArea ? AGENT_LINKS : CUSTOMER_LINKS;
  const [mode, setMode] = useState<Health | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (e) {
      // The cookie wasn't cleared, so the user is still signed in: say so rather than pretend.
      setSignOutError(`Sign-out failed: ${(e as Error).message}`);
      setSigningOut(false);
    }
  }
  useEffect(() => {
    // The AI status is operational detail for agents; customers never see which model runs.
    if (agentArea) api.health().then(setMode).catch(() => setMode(null));
  }, [agentArea]);

  const aiText = !mode ? '' : mode.aiMode === 'llm' ? mode.model : mode.aiMode === 'degraded' ? `${mode.model} unavailable, using fallback` : 'fallback mode';
  return (
    <header className="topbar">
      <div className="brand">
        Refund<span>Desk</span>
        {agentArea && <span className="brand-area">Agent</span>}
      </div>
      {links.length > 0 && (
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? 'active' : ''} aria-current={path === l.href ? 'page' : undefined}>
              <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d={l.icon} />
              </svg>
              <span className="nav-long">{l.long}</span>
              <span className="nav-short">{l.short}</span>
            </Link>
          ))}
        </nav>
      )}
      <div className="spacer" />
      {agentArea && mode && (
        <span
          className={`badge ai-badge ai-${mode.aiMode}`}
          title={mode.aiMode === 'fallback' ? 'No API key: keyword classifier + templates' : mode.aiError ?? mode.model ?? ''}
          aria-label={`AI: ${aiText}`}
        >
          <span className="ai-dot" aria-hidden="true" />
          <span>
            AI<span className="ai-detail">: {aiText}</span>
          </span>
        </span>
      )}
      {session ? (
        <div className="user-chip">
          {signOutError && (
            <span className="error-inline" role="alert">
              {signOutError}
            </span>
          )}
          <Link href="/account" className="user-name" title="Account settings">
            {session.name}
          </Link>
          <button type="button" className="btn btn-sm" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : (
        !AUTH_PAGES.includes(path) && (
          <Link href="/login" className="btn btn-sm">
            Sign in
          </Link>
        )
      )}
    </header>
  );
}

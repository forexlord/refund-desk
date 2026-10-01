'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { homeFor, useRedirectIfSignedIn, useSession } from '@/components/Session';
import { api, DemoAccount, OtpRequired, SignedIn } from '@/lib/api';

const fmtClock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Email + password sign-in. The server decides the account type: customers are signed in straight away,
 * agents get a second step for a one-time code.
 */
export function SignInForm({ audience }: { audience: 'customer' | 'staff' }) {
  useRedirectIfSignedIn();
  const { setSession } = useSession();
  const router = useRouter();
  const expired = useSearchParams().get('expired') === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<OtpRequired | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoAccount[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  // Demo pickers exist only when the backend serves them (DEMO_ACCOUNTS=true); otherwise the form is unchanged.
  useEffect(() => {
    api
      .demoAccounts()
      .then((d) => setDemo(audience === 'staff' ? d.agents : d.customers))
      .catch(() => setDemo(null));
  }, [audience]);

  function closePicker(returnFocus: boolean) {
    setPickerOpen(false);
    if (returnFocus) pickerButton.current?.focus();
  }

  function pick(a: DemoAccount) {
    setEmail(a.email);
    setPassword(a.password);
    setError(null);
    closePicker(false);
    passwordInput.current?.focus();
  }

  function finish(s: SignedIn) {
    setSession(s.user);
    router.replace(homeFor(s.user));
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(email.trim(), password);
      if (res.status === 'signed_in') return finish(res);
      setPassword('');
      setChallenge(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      finish(await api.verifyOtp(challenge.challengeId, code));
    } catch (err) {
      setError((err as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setChallenge(null);
    setCode('');
    setError(null);
  }

  const title = audience === 'staff' ? 'Staff sign-in' : 'Sign in';
  const subtitle = audience === 'staff' ? 'Refund Desk support team' : 'Manage your orders and refunds';

  return (
    <div className="auth">
      {!challenge ? (
        <form className="card auth-card" onSubmit={submitPassword}>
          <div className="auth-head">
            <h1>{title}</h1>
            <p className="muted">{subtitle}</p>
          </div>
          {expired && !error && <div className="notice">Your session expired. Please sign in again.</div>}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <div className="input-adorned">
              <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              {demo && demo.length > 0 && (
                <button
                  ref={pickerButton}
                  type="button"
                  className="adorn-btn"
                  aria-label={audience === 'staff' ? 'Choose a demo agent account' : 'Choose a demo customer account'}
                  aria-haspopup="dialog"
                  aria-expanded={pickerOpen}
                  aria-controls="demo-picker"
                  title="Demo accounts"
                  onClick={() => setPickerOpen((o) => !o)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                  </svg>
                </button>
              )}
              {pickerOpen && demo && (
                <>
                  <div className="picker-backdrop" onClick={() => closePicker(true)} aria-hidden="true" />
                  <div
                    id="demo-picker"
                    className="picker"
                    role="dialog"
                    aria-label="Demo accounts"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') closePicker(true);
                    }}
                  >
                    <div className="picker-h small muted">Demo accounts: picking one fills the form</div>
                    <ul className="picker-list">
                      {demo.map((a, i) => (
                        <li key={a.email}>
                          <button type="button" className="picker-item" autoFocus={i === 0} onClick={() => pick(a)}>
                            <span className="picker-name">{a.name}</span>
                            <span className="small muted">
                              {a.email} · {a.detail}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="field">
            <div className="label-row">
              <label className="label" htmlFor="password">
                Password
              </label>
              <Link href="/forgot-password" className="small">
                Forgot password?
              </Link>
            </div>
            <input
              ref={passwordInput}
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || !email.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="auth-foot small muted">
            {audience === 'staff' ? (
              <>
                Not staff? <Link href="/login">Customer sign-in</Link>
              </>
            ) : (
              <>
                Support staff? <Link href="/staff/login">Staff sign-in</Link>
              </>
            )}
          </div>
        </form>
      ) : (
        <form className="card auth-card" onSubmit={submitCode}>
          <div className="auth-head">
            <h1>Enter your code</h1>
            <p className="muted">
              We sent a 6-digit sign-in code to <strong>{email.trim()}</strong>. It expires at {fmtClock(challenge.expiresAt)}.
            </p>
          </div>
          {challenge.demoOtp && (
            <div className="notice">
              Demo: no email service is configured, so the code is shown here: <strong className="mono">{challenge.demoOtp}</strong>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="otp">
              Sign-in code
            </label>
            <input
              id="otp"
              className="input otp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : 'Verify and sign in'}
          </button>
          <div className="auth-foot small">
            <button type="button" className="link-btn" onClick={restart}>
              Use a different account
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

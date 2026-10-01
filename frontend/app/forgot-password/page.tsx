'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestReset(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-head">
          <h1>Reset your password</h1>
          <p className="muted">Enter your account email and we&apos;ll send you a link to choose a new password.</p>
        </div>
        {sentTo ? (
          <>
            <div className="notice" role="status">
              If an account exists for <strong>{sentTo}</strong>, a reset link is on its way. It expires in 30 minutes.
            </div>
            <div className="small muted">
              Demo: no email service is configured, so the link is written to the backend log (<code>docker compose logs backend</code>).
            </div>
          </>
        ) : (
          <>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="email">
                Email
              </label>
              <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}
        <div className="auth-foot small muted">
          <Link href="/login">Back to sign-in</Link>
        </div>
      </form>
    </div>
  );
}

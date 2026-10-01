'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { NewPasswordFields, newPasswordError } from '@/components/NewPasswordFields';
import { useSession } from '@/components/Session';
import { api } from '@/lib/api';

export default function AccountPage() {
  const { session, loading, setSession } = useSession();
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = newPasswordError(password, confirm);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.changePassword(current, password);
      setSession(res.user);
      setCurrent('');
      setPassword('');
      setConfirm('');
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!session) return <div className="skeleton" style={{ height: 320, maxWidth: 420, margin: '0 auto' }} />;

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-head">
          <h1>Your account</h1>
          <p className="muted">
            {session.name} · {session.email}
          </p>
        </div>
        {saved && (
          <div className="notice" role="status">
            Password changed. You&apos;ve been signed out everywhere else.
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="current-password">
            Current password
          </label>
          <input
            id="current-password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <button className="btn btn-primary btn-block" disabled={busy || !current}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}

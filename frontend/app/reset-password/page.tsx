'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { NewPasswordFields, newPasswordError } from '@/components/NewPasswordFields';
import { api } from '@/lib/api';

function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = newPasswordError(password, confirm);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      await api.confirmReset(token, password);
      setDone(true);
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
          <h1>Choose a new password</h1>
          <p className="muted">Setting a new password signs you out on every device.</p>
        </div>
        {!token ? (
          <div className="error" role="alert">
            This reset link is incomplete. Request a new one from <Link href="/forgot-password">Forgot password</Link>.
          </div>
        ) : done ? (
          <div className="notice" role="status">
            Your password has been updated. <Link href="/login">Sign in</Link> or use <Link href="/staff/login">staff sign-in</Link>.
          </div>
        ) : (
          <>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

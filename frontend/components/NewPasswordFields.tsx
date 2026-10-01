'use client';

export const PASSWORD_MIN_LENGTH = 12;

/** New password + confirmation. Returns an error message for the current values, or null when valid. */
export function newPasswordError(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password !== confirm) return "The passwords don't match.";
  return null;
}

export function NewPasswordFields(props: { password: string; confirm: string; onPassword: (v: string) => void; onConfirm: (v: string) => void }) {
  return (
    <>
      <div className="field">
        <label className="label" htmlFor="new-password">
          New password
        </label>
        <input
          id="new-password"
          className="input"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          aria-describedby="new-password-hint"
          value={props.password}
          onChange={(e) => props.onPassword(e.target.value)}
        />
        <div id="new-password-hint" className="small muted">
          At least {PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="confirm-password">
          Confirm new password
        </label>
        <input
          id="confirm-password"
          className="input"
          type="password"
          autoComplete="new-password"
          required
          value={props.confirm}
          onChange={(e) => props.onConfirm(e.target.value)}
        />
      </div>
    </>
  );
}

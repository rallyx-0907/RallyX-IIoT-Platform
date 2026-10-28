import { t as translate, LanguageSelector } from '../i18n';
import { useState, type FormEvent } from 'react';
import { post, errorMessage } from '../api/client';
import type { User } from '../types/platform';

export function AuthForm({ user, onUser, initialError = '' }: { user?: User | null; onUser: (user: User) => void; initialError?: string }) {
  const changing = !!user?.must_change_password;
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = changing
        ? await post<User>('/auth/password', { current_password: form.get('current'), new_password: form.get('new') })
        : await post<User>('/auth/login', { username: form.get('username'), password: form.get('password') });
      onUser(result);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="auth-screen"><div className="auth-visual"><div className="wordmark">R<span>✦</span> RallyX</div><p className="eyebrow">{translate("INTELLIGENCE AT THE EDGE")}</p><h1>{translate("Your equipment.")}<br />{translate("A clearer picture.")}</h1><p>{translate("Live operating data, trusted history, and the signals that matter. All on your local network.")}</p><div className="auth-grid"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><small>{translate("RALLYX IIoT PLATFORM · LOCAL OPERATIONS")}</small></div>
    <div className="auth-panel"><div className="auth-content"><div className="auth-language"><LanguageSelector /></div><form onSubmit={submit}><p className="eyebrow">{translate("YOUR LOCAL WORKSPACE")}</p><h1>{changing ? translate("Set your password") : translate("Sign in to RallyX")}</h1><p className="muted">{changing ? translate("Replace the installation password before accessing your workspace. Use 16–72 bytes.") : translate("Use the account provided by your installation administrator.")}</p>
      {error && <p role="alert" className="error">{translate(error)}</p>}
      {changing ? <><label>{translate("Current password")}<input name="current" type="password" autoComplete="current-password" required /></label><label>{translate("New password")}<input name="new" type="password" minLength={16} maxLength={72} autoComplete="new-password" required /></label></> : <><label>{translate("Username")}<input name="username" autoComplete="username" required /></label><label>{translate("Password")}<input name="password" type="password" autoComplete="current-password" required /></label></>}
      <button className="primary" disabled={busy}>{busy ? translate("Please wait…") : changing ? translate("Save password") : translate("Sign in")}</button><p className="auth-footnote">{translate("Read-only field integration · Your data stays local")}</p>
    </form></div></div></div>;
}

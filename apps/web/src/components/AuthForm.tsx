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
  return <div className="auth-screen"><div className="auth-visual"><div className="wordmark">R<span>✦</span> RallyX</div><p className="eyebrow">INTELLIGENCE AT THE EDGE</p><h1>Your equipment.<br />A clearer picture.</h1><p>Live operating data, trusted history, and the signals that matter. All on your local network.</p><div className="auth-grid"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><small>RALLYX IIoT PLATFORM · LOCAL OPERATIONS</small></div>
    <div className="auth-panel"><form onSubmit={submit}><p className="eyebrow">YOUR LOCAL WORKSPACE</p><h1>{changing ? 'Set your password' : 'Sign in to RallyX'}</h1><p className="muted">{changing ? 'Replace the installation password before accessing your workspace. Use 16–72 bytes.' : 'Use the account provided by your installation administrator.'}</p>
      {error && <p role="alert" className="error">{error}</p>}
      {changing ? <><label>Current password<input name="current" type="password" autoComplete="current-password" required /></label><label>New password<input name="new" type="password" minLength={16} maxLength={72} autoComplete="new-password" required /></label></> : <><label>Username<input name="username" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label></>}
      <button className="primary" disabled={busy}>{busy ? 'Please wait…' : changing ? 'Save password' : 'Sign in'}</button><p className="auth-footnote">Read-only field integration · Your data stays local</p>
    </form></div></div>;
}

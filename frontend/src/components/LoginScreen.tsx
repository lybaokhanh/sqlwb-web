// App login (not the database login). First login of a new name creates the account.
import { useState } from 'react';
import { login } from '../boot';

export function LoginScreen({ overlay }: { overlay: boolean }) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(name.trim(), pw);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`login-screen${overlay ? ' overlay' : ''}`}>
      <form className="login-card form" onSubmit={submit} aria-label="Log in">
        <div className="login-brand">SQL Workbench/J <span>Web</span></div>
        {overlay && <div className="form-note">Your session ended. Log in again.</div>}
        <label>Name<input name="appUser" autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" /></label>
        <label>Password<input name="appPassword" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button type="submit" className="btn primary" disabled={busy || !name.trim() || !pw}>Log in</button>
        <div className="login-note">First login with a new name creates the account.</div>
      </form>
    </div>
  );
}

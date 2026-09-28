import React, { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Button, Field, Icon, Input, useToast } from '../components/ui';

/** Activation + Login screens. */
export function AuthPages({ mode, onDone }: { mode: 'activate' | 'login'; onDone: () => void }) {
  return mode === 'activate' ? <ActivateScreen onDone={onDone} /> : <LoginScreen onDone={onDone} />;
}

function ActivateScreen({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = code.replace(/[\s-]/g, '');
    if (!/^\d{16}$/.test(digits)) {
      setError('Enter the 16-digit activation code provided with your license.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api('activation.verify', { code: digits });
      if (res.ok) {
        toast.push({ kind: 'success', title: 'Dentiva Pro activated', msg: 'Continue to set up your clinic.' });
        onDone();
      } else {
        setError('Invalid activation code. Please check the code and try again.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Activation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-mark">
            <Icon name="tooth" size={24} />
          </div>
          <div>
            <h1>Dentiva Pro</h1>
            <div className="sub">Professional Offline Dental Clinic Management</div>
          </div>
        </div>
        <div className="alert alert-info" style={{ marginBottom: 18 }}>
          <Icon name="key" size={16} />
          <div>
            <strong>One-time activation required.</strong>
            <br />
            Enter the activation code included with your Dentiva Pro license. Activation runs fully offline.
          </div>
        </div>
        <Field label="Activation code" required error={error}>
          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="16-digit code"
            maxLength={24}
            style={{ letterSpacing: '0.14em', fontSize: 17, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
          />
        </Field>
        <Button type="submit" variant="primary" block size="lg" loading={busy} style={{ marginTop: 18 }}>
          Activate Dentiva Pro
        </Button>
        <p className="tiny muted" style={{ marginTop: 14, textAlign: 'center' }}>
          Activation is verified locally — no internet connection is required.
        </p>
      </form>
    </div>
  );
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api('auth.login', { username: username.trim(), password });
      if (res.ok) {
        toast.push({ kind: 'success', title: `Welcome back, ${res.user?.displayName || res.user?.username}` });
        onDone();
      } else {
        const map: Record<string, string> = {
          invalid_credentials: 'Incorrect username or password.',
          locked: 'Account temporarily locked after failed attempts. Try again later.',
          inactive: 'This account has been deactivated.',
          rate_limited: 'Too many attempts. Please wait a moment and try again.',
        };
        setError(map[res.reason ?? 'invalid_credentials'] ?? 'Sign in failed.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-mark">
            <Icon name="tooth" size={24} />
          </div>
          <div>
            <h1>Dentiva Pro</h1>
            <div className="sub">Sign in to continue</div>
          </div>
        </div>
        <div className="col" style={{ gap: 'var(--sp-4)' }}>
          <Field label="Username" required>
            <Input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Username"
            />
          </Field>
          <Field label="Password" required error={error}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Password"
            />
          </Field>
          <Button type="submit" variant="primary" block size="lg" loading={busy}>
            Sign in
          </Button>
        </div>
        <p className="tiny muted" style={{ marginTop: 16, textAlign: 'center' }}>
          Locked screen? Use your password to unlock. Contact the clinic administrator if you forgot your credentials.
        </p>
      </form>
    </div>
  );
}

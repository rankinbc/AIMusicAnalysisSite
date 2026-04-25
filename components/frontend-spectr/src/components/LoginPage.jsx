import { useState } from 'react';
import { EQLoader } from './primitives';
import { login, register } from '../api/client';

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const fn = mode === 'login' ? login : register;
      await fn(email, password);
      onLogin();
    } catch (err) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div className="fade-up" style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ fontWeight: 800, fontSize: 36, letterSpacing: '0.22em', color: 'var(--cyan)', marginBottom: 8 }}>SPECTR</div>
        <EQLoader count={9} height={28} />
        <p style={{ color: 'var(--muted)', marginTop: 20, fontSize: 15 }}>
          AI mix analysis for electronic producers
        </p>
      </div>

      <form
        onSubmit={submit}
        className="fade-up"
        style={{
          width: '100%', maxWidth: 380,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 16, padding: 32,
          animationDelay: '0.1s',
        }}
      >
        <div style={{ display: 'flex', gap: 0, marginBottom: 28, background: 'var(--dim)', borderRadius: 8, padding: 4 }}>
          {['login', 'register'].map(m => (
            <button
              key={m} type="button"
              onClick={() => { setMode(m); setError(''); }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 13, fontWeight: 600,
                background: mode === m ? 'var(--cyan)' : 'transparent',
                color: mode === m ? '#070a12' : 'var(--muted)',
                transition: 'all 0.18s',
              }}
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.08em' }}>EMAIL</div>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            required autoComplete="email"
            style={{
              width: '100%', padding: '11px 14px', borderRadius: 8,
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text)', fontFamily: 'Syne, sans-serif', fontSize: 14,
              outline: 'none', transition: 'border-color 0.2s',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--cyan)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.08em' }}>PASSWORD</div>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            required autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            style={{
              width: '100%', padding: '11px 14px', borderRadius: 8,
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text)', fontFamily: 'Syne, sans-serif', fontSize: 14,
              outline: 'none', transition: 'border-color 0.2s',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--cyan)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </div>

        {error && (
          <div className="mono" style={{ fontSize: 12, color: 'var(--red)', background: 'var(--red-dim)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '13px 0', borderRadius: 9,
            background: loading ? 'rgba(0,229,176,0.4)' : 'var(--cyan)',
            color: '#070a12', fontSize: 15, fontWeight: 800, letterSpacing: '0.04em',
            boxShadow: '0 0 24px rgba(0,229,176,0.25)', transition: 'all 0.2s',
          }}
        >
          {loading ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

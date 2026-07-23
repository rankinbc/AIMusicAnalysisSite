import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';

import { useAuth } from '../../auth/AuthContext';
import f from '../../styles/forms.module.css';
import s from './auth.module.css';

const search = z.object({
  next: z.string().optional(),
});

export const Route = createFileRoute('/_public/login')({
  validateSearch: search,
  component: LoginPage,
});

const DEV_EMAIL = 'brankin92@yahoo.com';

function LoginPage() {
  const { login, devLogin } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const { next } = Route.useSearch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email, password);
      // F8: the _app guard reads router context — invalidate so it sees the
      // fresh auth state BEFORE navigating, or the first click bounces back.
      await router.invalidate();
      await navigate({ to: next ?? '/library' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setPending(false);
    }
  };

  // Development-only convenience: one click signs in as the dev account.
  const handleDevLogin = async () => {
    setError(null);
    setPending(true);
    try {
      await devLogin(DEV_EMAIL);
      await router.invalidate();
      await navigate({ to: next ?? '/library' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dev sign-in failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={s.card}>
      <div className={s.header}>
        <h1 className={s.title}>Sign in</h1>
        <p className={s.subtitle}>Welcome back.</p>
      </div>
      <form onSubmit={handleSubmit} className={s.form}>
        <label className={f.label}>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={f.input}
          />
        </label>
        <label className={f.label}>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={f.input}
          />
        </label>
        {error && <p className={f.error}>{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className={`${f.button} ${f.buttonPrimary} ${s.submit}`}
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={handleDevLogin}
          disabled={pending}
          className={`${f.button} ${s.submit}`}
        >
          Dev sign-in ({DEV_EMAIL})
        </button>
      )}
      <p className={s.footerLink}>
        No account?
        <Link to="/register">Create one</Link>
      </p>
      <p className={s.footerLink}>
        Forgot your password?
        <Link to="/forgot-password">Reset it</Link>
      </p>
    </div>
  );
}

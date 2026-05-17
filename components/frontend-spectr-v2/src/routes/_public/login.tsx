import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
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

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
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
      void navigate({ to: next ?? '/library' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
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
      <p className={s.footerLink}>
        No account?
        <Link to="/register">Create one</Link>
      </p>
    </div>
  );
}

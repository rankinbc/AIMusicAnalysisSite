import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { useAuth } from '../../auth/AuthContext';
import f from '../../styles/forms.module.css';
import s from './auth.module.css';

export const Route = createFileRoute('/_public/register')({
  component: RegisterPage,
});

function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setPending(true);
    try {
      await register(email, password);
      void navigate({ to: '/library' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={s.card}>
      <div className={s.header}>
        <h1 className={s.title}>Create account</h1>
        <p className={s.subtitle}>Sign up for SPECTR.</p>
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
            autoComplete="new-password"
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
          {pending ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className={s.footerLink}>
        Already have an account?
        <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}

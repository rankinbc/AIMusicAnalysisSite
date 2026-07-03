import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';

import { fetcher } from '../../api/fetcher';
import { ResetPasswordView } from '../../features/auth/AuthFlowViews';

const search = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute('/_public/reset-password')({
  validateSearch: search,
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setPending(true);
    try {
      await fetcher<void>({
        url: '/auth/reset-password',
        method: 'POST',
        data: { token, newPassword: password },
      });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'This link may be expired — request a new one.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <ResetPasswordView
      hasToken={Boolean(token)}
      password={password}
      done={done}
      pending={pending}
      error={error}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
      loginLink={<Link to="/login">Back to sign in</Link>}
    />
  );
}

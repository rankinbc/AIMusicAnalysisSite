import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
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
  // Capture once, then strip the single-use token from the visible URL and
  // browser history while the user types the new password.
  const [captured] = useState(() => token);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (captured) window.history.replaceState(null, '', window.location.pathname);
  }, [captured]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!captured) return;
    setError(null);
    setPending(true);
    try {
      await fetcher<void>({
        url: '/auth/reset-password',
        method: 'POST',
        data: { token: captured, newPassword: password },
      });
      setDone(true);
    } catch {
      // Friendly copy always — raw "HTTP 400" from the fetcher helps nobody.
      setError('That link is invalid or expired — request a new one from the reset page.');
    } finally {
      setPending(false);
    }
  };

  return (
    <ResetPasswordView
      hasToken={Boolean(captured)}
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

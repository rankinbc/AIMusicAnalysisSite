import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { fetcher } from '../../api/fetcher';
import { ForgotPasswordView } from '../../features/auth/AuthFlowViews';

export const Route = createFileRoute('/_public/forgot-password')({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await fetcher<void>({ url: '/auth/forgot-password', method: 'POST', data: { email } });
      setSent(true); // server always 204s — same message either way (no oracle)
    } catch {
      // Friendly copy always (a 429 here just means slow down).
      setError('Something went wrong — wait a moment and try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <ForgotPasswordView
      email={email}
      sent={sent}
      pending={pending}
      error={error}
      onEmailChange={setEmail}
      onSubmit={handleSubmit}
      loginLink={<Link to="/login">Back to sign in</Link>}
    />
  );
}

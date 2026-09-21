import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { fetcher } from '../../api/fetcher';
import { VerifyEmailView, type VerifyStatus } from '../../features/auth/AuthFlowViews';
import { optionalString } from '../../lib/search-params';

export const Route = createFileRoute('/_public/verify-email')({
  validateSearch: optionalString('token'),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token } = Route.useSearch();
  // Capture once — the URL is stripped below so the single-use token never
  // lingers in the address bar or browser history.
  const [captured] = useState(() => token);
  const [status, setStatus] = useState<VerifyStatus>(captured ? 'verifying' : 'missing');
  // StrictMode double-mount guard: the token is single-use — the second
  // (dev-only) effect run must not consume-then-fail it.
  const fired = useRef(false);

  useEffect(() => {
    if (!captured || fired.current) return;
    fired.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    fetcher<void>({ url: '/auth/verify-email', method: 'POST', data: { token: captured } })
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [captured]);

  return (
    <VerifyEmailView
      status={status}
      loginLink={<Link to="/login">Go to sign in</Link>}
    />
  );
}

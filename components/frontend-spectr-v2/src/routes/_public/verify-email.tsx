import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { fetcher } from '../../api/fetcher';
import { VerifyEmailView, type VerifyStatus } from '../../features/auth/AuthFlowViews';

const search = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute('/_public/verify-email')({
  validateSearch: search,
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token } = Route.useSearch();
  const [status, setStatus] = useState<VerifyStatus>(token ? 'verifying' : 'missing');
  // StrictMode double-mount guard: the token is single-use — the second
  // (dev-only) effect run must not consume-then-fail it.
  const fired = useRef(false);

  useEffect(() => {
    if (!token || fired.current) return;
    fired.current = true;
    fetcher<void>({ url: '/auth/verify-email', method: 'POST', data: { token } })
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <VerifyEmailView
      status={status}
      loginLink={<Link to="/login">Go to sign in</Link>}
    />
  );
}

import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { VerifyEmailView, type VerifyStatus } from '../../features/auth/AuthFlowViews';
import { verifyStatusForError } from '../../features/auth/verify-status';
import { ResendByEmailForm } from '../../features/auth/VerificationViews';
import { useResendVerification } from '../../features/auth/useResendVerification';
import { optionalString } from '../../lib/search-params';

export const Route = createFileRoute('/_public/verify-email')({
  validateSearch: optionalString('token'),
  component: VerifyEmailPage,
});

export function VerifyEmailPage() {
  const { token } = Route.useSearch();
  const { verifyEmail } = useAuth();
  const router = useRouter();
  const navigate = useNavigate();
  // Capture once — the URL is stripped below so the single-use token never
  // lingers in the address bar or browser history.
  const [captured] = useState(() => token);
  const [status, setStatus] = useState<VerifyStatus>(captured ? 'verifying' : 'missing');
  const [email, setEmail] = useState('');
  const resend = useResendVerification();
  // StrictMode double-mount guard: the token is single-use — the second
  // (dev-only) effect run must not consume-then-fail it.
  const fired = useRef(false);

  useEffect(() => {
    if (!captured || fired.current) return;
    fired.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    verifyEmail(captured)
      .then(async (res) => {
        if (!res) {
          // Verified, but no session came back — sign in normally.
          setStatus('signin');
          return;
        }
        setStatus('success');
        // The link signed them in: land in the app. The _app guard reads
        // router context — invalidate first (F8) so it sees the session.
        await router.invalidate();
        await navigate({ to: '/library' });
      })
      .catch((err: unknown) => setStatus(verifyStatusForError(err)));
  }, [captured, verifyEmail, router, navigate]);

  const onResend = (e: FormEvent) => {
    e.preventDefault();
    void resend.send(email);
  };

  return (
    <VerifyEmailView
      status={status}
      loginLink={<Link to="/login">Go to sign in</Link>}
      registerLink={<Link to="/register">Create an account</Link>}
      resendForm={
        <ResendByEmailForm
          email={email}
          onEmailChange={setEmail}
          resend={resend}
          onSubmit={onResend}
        />
      }
    />
  );
}

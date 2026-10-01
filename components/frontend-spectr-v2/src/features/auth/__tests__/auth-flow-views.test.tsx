// @vitest-environment node
// Story 4.3 — static renders of the pure verify/forgot/reset views.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ForgotPasswordView,
  ResetPasswordView,
  VerifyEmailView,
} from '../AuthFlowViews';

const noop = () => {};
const login = <a href="/login">Back to sign in</a>;

describe('VerifyEmailView', () => {
  const resendForm = <form aria-label="resend-form" />;
  const register = <a href="/register">Create an account</a>;
  const render = (status: Parameters<typeof VerifyEmailView>[0]['status']) =>
    renderToStaticMarkup(
      <VerifyEmailView
        status={status}
        loginLink={login}
        registerLink={register}
        resendForm={resendForm}
      />,
    );

  it('renders every status distinctly', () => {
    const verifying = render('verifying');
    expect(verifying).toContain('Checking your link');
    expect(verifying).not.toContain('href="/login"'); // no CTA mid-check

    // Verify-before-sign-in: the link signs in, so success is a redirect
    // beat, not a "go sign in" page.
    const success = render('success');
    expect(success).toContain('signing you in');
    expect(success).not.toContain('href="/login"');

    const signin = render('signin');
    expect(signin).toContain('Verified');
    expect(signin).toContain('href="/login"');

    const error = render('error');
    expect(error).toContain('invalid, expired, or already used');
    expect(error).toContain('resend-form');

    const missing = render('missing');
    expect(missing).toContain('No verification token');
    expect(missing).toContain('resend-form');

    const expired = render('guest_expired');
    expect(expired).toContain('guest session ended');
    expect(expired).toContain('href="/register"');
    expect(expired).not.toContain('resend-form');

    expect(render('email_taken')).toContain('already registered');
    expect(render('banned')).toContain('suspended');
  });
});

describe('ForgotPasswordView', () => {
  it('shows the form until sent, then the no-oracle message', () => {
    const form = renderToStaticMarkup(
      <ForgotPasswordView
        email="a@b.c" sent={false} pending={false} error={null}
        onEmailChange={noop} onSubmit={noop} loginLink={login}
      />,
    );
    expect(form).toContain('Send reset link');

    const sent = renderToStaticMarkup(
      <ForgotPasswordView
        email="a@b.c" sent={true} pending={false} error={null}
        onEmailChange={noop} onSubmit={noop} loginLink={login}
      />,
    );
    // Identical message whether the account exists — enumeration-safe copy.
    expect(sent).toContain('If that address has an account');
    expect(sent).not.toContain('Send reset link');
  });
});

describe('ResetPasswordView', () => {
  it('handles token-missing, form, and done states', () => {
    const missing = renderToStaticMarkup(
      <ResetPasswordView
        hasToken={false} password="" done={false} pending={false} error={null}
        onPasswordChange={noop} onSubmit={noop} loginLink={login}
      />,
    );
    expect(missing).toContain('No reset token');
    expect(missing).not.toContain('Set new password');

    const form = renderToStaticMarkup(
      <ResetPasswordView
        hasToken={true} password="" done={false} pending={false} error={null}
        onPasswordChange={noop} onSubmit={noop} loginLink={login}
      />,
    );
    expect(form).toContain('Set new password');

    const done = renderToStaticMarkup(
      <ResetPasswordView
        hasToken={true} password="" done={true} pending={false} error={null}
        onPasswordChange={noop} onSubmit={noop} loginLink={login}
      />,
    );
    expect(done).toContain('Every other session was signed out');
    expect(done).not.toContain('Set new password');
  });
});

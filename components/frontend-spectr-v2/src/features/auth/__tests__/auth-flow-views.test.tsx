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
  it('renders every status distinctly', () => {
    const verifying = renderToStaticMarkup(
      <VerifyEmailView status="verifying" loginLink={login} />,
    );
    expect(verifying).toContain('Checking your link');
    expect(verifying).not.toContain('href="/login"'); // no CTA mid-check

    const success = renderToStaticMarkup(
      <VerifyEmailView status="success" loginLink={login} />,
    );
    expect(success).toContain('Verified');
    expect(success).toContain('href="/login"');

    const error = renderToStaticMarkup(
      <VerifyEmailView status="error" loginLink={login} />,
    );
    expect(error).toContain('invalid, expired, or already used');

    const missing = renderToStaticMarkup(
      <VerifyEmailView status="missing" loginLink={login} />,
    );
    expect(missing).toContain('No verification token');
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

// DRAFT: needs founder review before public launch (story 6.2 AC7 / launch checklist).
import { createFileRoute } from '@tanstack/react-router';

import { TrustPage } from '../features/trust/TrustPage';

// Story 6.2 (FR41) — privacy DEFAULTS in plain language. This is not a legal
// privacy policy (that's a launch-checklist item); it states the shipped
// defaults: private-by-default (7.1), revocable share links (7.3), 72h anon
// purge (4.5), GDPR export/delete (4.6), self-hosted fonts (1.7).
export const Route = createFileRoute('/trust/privacy')({
  component: PrivacyDefaultsPage,
});

export function PrivacyDefaultsPage() {
  return (
    <TrustPage
      path="/trust/privacy"
      title="Privacy defaults"
      metaDescription="SPECTR's privacy defaults: private-by-default library, opt-in revocable share links, anonymous analysis data purged after 72 hours, full export and deletion."
      updated="2026-07-14"
    >
      <p>
        This page states how SPECTR behaves by default, in plain language. It is a summary of
        shipped behavior, not a legal privacy policy.
      </p>
      <h2>Private by default</h2>
      <ul>
        <li>
          Your library, tracks, and reports are visible only to you. Nothing is public unless you
          explicitly share it.
        </li>
        <li>
          Share links are opt-in, scoped to what you choose to expose, and revocable — revoking a
          link kills it immediately for everyone who has it.
        </li>
      </ul>
      <h2>Anonymous visitors</h2>
      <ul>
        <li>
          Someone who runs an anonymous analysis without creating an account gets a device
          identity, not a profile. That device data — and its analyses — is purged after 72
          hours if it never becomes an account.
        </li>
        <li>
          Comments and bookmarks that reviewers leave on a track you shared are different: they
          are feedback addressed to you, so they stay with your track until you delete them (you
          moderate and can remove any of them).
        </li>
      </ul>
      <h2>Your data, your controls</h2>
      <ul>
        <li>Export everything — reports, comments, account data — from your account settings.</li>
        <li>
          Delete your account at any time: one flow removes your audio, reports, and identity
          permanently.
        </li>
      </ul>
      <h2>No ad trackers riding along</h2>
      <ul>
        <li>Fonts and page assets are self-hosted — no third-party font or asset CDNs.</li>
        <li>
          We do run operational tooling: error monitoring (Sentry) and product analytics
          (PostHog), bundled with the app to keep the service working. No advertising trackers,
          and your data is never sold.
        </li>
      </ul>
    </TrustPage>
  );
}

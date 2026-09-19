// DRAFT: needs founder review before public launch (story 6.2 AC7 / launch checklist).
import { createFileRoute } from '@tanstack/react-router';

import { TrustPage } from '../features/trust/TrustPage';

// Story 6.2 (FR41) — privacy DEFAULTS in plain language. This is not a legal
// privacy policy (that's a launch-checklist item); it states the shipped
// defaults: private by design — no public pages, no profiles, no share links
// (solo fork) — 72h anon purge (4.5), GDPR export/delete (4.6), self-hosted
// fonts (1.7).
export const Route = createFileRoute('/trust/privacy')({
  component: PrivacyDefaultsPage,
});

export function PrivacyDefaultsPage() {
  return (
    <TrustPage
      path="/trust/privacy"
      title="Privacy defaults"
      metaDescription="Your uploads are private: no public pages, no profiles, no share links."
      updated="2026-07-14"
    >
      <p>
        This page states how SPECTR behaves by default, in plain language. It is a summary of
        shipped behavior, not a legal privacy policy.
      </p>
      <h2>Private by design</h2>
      <p>
        Nothing you upload is visible to anyone else. SPECTR has no public pages, no profiles
        and no share links — your tracks, reports and notes are reachable only from your
        signed-in account.
      </p>
      <h2>Anonymous visitors</h2>
      <ul>
        <li>
          Someone who runs an anonymous analysis without creating an account gets a device
          identity, not a profile. That device data — and its analyses — is purged after 72
          hours if it never becomes an account.
        </li>
      </ul>
      <h2>Your data, your controls</h2>
      <ul>
        <li>Export everything — reports, notes, account data — from your account settings.</li>
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

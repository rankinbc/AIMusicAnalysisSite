// DRAFT: needs founder review before public launch (story 6.2 AC7 / launch checklist).
import { createFileRoute } from '@tanstack/react-router';

import { TrustPage } from '../features/trust/TrustPage';

// Story 6.2 (FR41/AR15) — results-forever, stated honestly: REPORTS are kept
// forever; RAW AUDIO has a separate retention schedule (story 3.4). Claims
// trace to retention_actor.py (reports never deleted; raw audio 30d free /
// 90d post-lapse) and the AR15 billing behavior.
export const Route = createFileRoute('/trust/results-forever')({
  component: ResultsForeverPage,
});

export function ResultsForeverPage() {
  return (
    <TrustPage
      path="/trust/results-forever"
      title="Your results stay yours"
      metaDescription="SPECTR's results-forever policy: every report you generate remains accessible after cancellation. Raw audio retention is separate and stated plainly."
      updated="2026-07-14"
    >
      <h2>Reports never expire</h2>
      <ul>
        <li>
          Every analysis report you generate stays accessible in your account — after your
          subscription lapses, after you cancel, on the free tier. Cancelling costs you access
          to no report you already made.
        </li>
        <li>No re-subscription is required to read, share, or export your past reports.</li>
      </ul>
      <h2>Uploaded files are different — here's the honest part</h2>
      <p>
        Reports are small; audio and project files are large. We keep your <b>reports</b>{' '}
        forever, but the <b>files you uploaded</b> — the mix, stems, reference track, and
        Ableton project file — follow a retention schedule:
      </p>
      <ul>
        <li>Free tier: uploaded files are removed 30 days after upload.</li>
        <li>After a paid subscription lapses: uploaded files are removed 90 days after the lapse.</li>
        <li>
          When files are removed, the report — every measurement, grade, and finding — remains
          intact. Playback and re-download of the originals is what goes away.
        </li>
      </ul>
      <h2>Deleting is always yours to do</h2>
      <p>
        You can delete any song or version at any time, and deleting your account removes your
        audio, your reports, and your identity — permanently.
      </p>
    </TrustPage>
  );
}

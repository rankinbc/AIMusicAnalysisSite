// DRAFT: needs founder review before public launch (story 6.2 AC7 / launch checklist).
import { createFileRoute } from '@tanstack/react-router';

import { TrustPage } from '../features/trust/TrustPage';

// Story 6.2 (FR41/NFR12) — the VERSIONED no-training pledge. Every claim below
// traces to shipped code (verified at story creation + dev): the LLM gateway is
// a plain Anthropic SDK text call (worker/app/llm/gateway.py); prompt builders
// (verdict_lib, coach_lib) contain no audio-file/bytes/base64 path. Changes to
// this page bump PLEDGE_VERSION.
export const PLEDGE_VERSION = '1.0';
export const PLEDGE_EFFECTIVE = '2026-07-14';

export const Route = createFileRoute('/trust/no-training')({
  component: NoTrainingPage,
});

export function NoTrainingPage() {
  return (
    <TrustPage
      path="/trust/no-training"
      title="No AI training on your audio"
      metaDescription="SPECTR's no-training pledge: your audio is never used to train AI models, and raw audio is never sent to any LLM."
      updated={PLEDGE_EFFECTIVE}
    >
      <p className="mono" data-testid="pledge-version">
        Pledge version {PLEDGE_VERSION} · effective {PLEDGE_EFFECTIVE}
      </p>
      <p>
        You upload unreleased music to SPECTR. That deserves a plain commitment, not fine print:
      </p>
      <h2>Your audio never trains a model</h2>
      <ul>
        <li>
          SPECTR does not train, fine-tune, or improve any AI model on your audio, your stems,
          your project files, or your reports. Ever.
        </li>
        <li>
          <b>Raw audio is never sent to any LLM.</b> The analysis pipeline measures your file on
          our own infrastructure. When our AI coach or specialists run, they receive only derived
          text — measurements, scores, and findings from your report — never the audio itself.
        </li>
        <li>
          The AI features use the Anthropic API under its commercial terms, which do not use API
          inputs or outputs to train models by default. We have not opted into any data-sharing
          or training program.
        </li>
      </ul>
      <h2>Where your audio actually lives</h2>
      <p>
        Uploaded audio is stored in SPECTR-controlled storage and read only by the analysis
        pipeline and your own playback. See the privacy defaults page for retention specifics.
      </p>
      <h2>Versioning</h2>
      <p>
        This pledge is versioned. Any change bumps the version number above and is noted on this
        page — the full history lives in our source repository.
      </p>
    </TrustPage>
  );
}

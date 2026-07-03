// Story 10.3 — Sentry, DSN-gated (no VITE_SENTRY_DSN = fully disabled).
import * as Sentry from '@sentry/react';

const DSN = import.meta.env['VITE_SENTRY_DSN'] as string | undefined;

export function initSentry(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0, // errors only — tracing out of 10.3 scope
  });
}

// Correlation tag (NFR30): the results page stamps the job id so a frontend
// render error joins the upload → job → actors → LLM chain.
export function setCorrelation(id: string | null): void {
  if (!DSN) return;
  Sentry.getCurrentScope().setTag('correlation_id', id ?? undefined);
}

export { Sentry };

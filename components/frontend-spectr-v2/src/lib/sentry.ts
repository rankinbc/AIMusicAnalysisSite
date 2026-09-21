// Story 10.3 — Sentry, DSN-gated (no VITE_SENTRY_DSN = fully disabled).
//
// P7 (bundle diet) — @sentry/react is a dynamic import made only when a DSN
// is present, so a keyless build never pays for it. Errors and correlation
// tags reported before the SDK finishes loading are buffered (bounded) and
// flushed on load; an init failure drops the buffer silently.
type SentrySdk = typeof import('@sentry/react');

const DSN = import.meta.env['VITE_SENTRY_DSN'] as string | undefined;
const MAX_BUFFER = 20;
let sdk: SentrySdk | null = null;
let loading = false;
const buffer: unknown[] = [];
let pendingCorrelation: string | null | undefined;

export function initSentry(): void {
  if (!DSN || loading || sdk) return;
  loading = true;
  void import('@sentry/react')
    .then((S) => {
      S.init({
        dsn: DSN,
        environment: import.meta.env.MODE,
        tracesSampleRate: 0, // errors only — tracing out of 10.3 scope
      });
      sdk = S;
      if (pendingCorrelation !== undefined) {
        S.getCurrentScope().setTag('correlation_id', pendingCorrelation ?? undefined);
      }
      for (const e of buffer.splice(0)) S.captureException(e);
    })
    .catch(() => {
      buffer.length = 0;
    });
}

// Correlation tag (NFR30): the results page stamps the job id so a frontend
// render error joins the upload → job → actors → LLM chain.
export function setCorrelation(id: string | null): void {
  if (!DSN) return;
  if (sdk) sdk.getCurrentScope().setTag('correlation_id', id ?? undefined);
  else pendingCorrelation = id;
}

// D10 — the router's notFound/error boundaries catch before the app error
// boundary ever sees anything, so route-level errors report through here
// instead.
export function reportError(err: unknown): void {
  if (!DSN) return;
  if (sdk) sdk.captureException(err);
  else if (buffer.length < MAX_BUFFER) buffer.push(err);
}

// Story 12.8 (AC2) — "Report a problem" mailto builder. Pure so the prefill
// contract is unit-testable. Carries what the client can actually READ:
// the page URL, the jobId when on a results route, and the most recent
// internal_error traceId when one was captured (there is no ambient
// correlation id on the happy path — 10.3's correlation is server-side only).

const RESULTS_ROUTE = /\/songs\/[^/]+\/results\/([0-9a-f-]{36})/i;

export function jobIdFromPath(pathname: string): string | null {
  const m = RESULTS_ROUTE.exec(pathname);
  return m ? m[1]!.toLowerCase() : null;
}

export function buildProblemReportMailto(input: {
  email: string;
  url: string;
  jobId?: string | null;
  traceId?: string | null;
}): string {
  const subject = 'SPECTR problem report';
  const lines = [
    'What happened:',
    '',
    '(describe the problem here)',
    '',
    '--- context (please keep) ---',
    `page: ${input.url}`,
  ];
  if (input.jobId) lines.push(`job: ${input.jobId}`);
  if (input.traceId) lines.push(`trace: ${input.traceId}`);
  lines.push(`time: ${new Date().toISOString()}`);
  return `mailto:${input.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

export const SUPPORT_EMAIL: string =
  (import.meta.env['VITE_SUPPORT_EMAIL'] as string | undefined) ?? 'brankin92@yahoo.com';

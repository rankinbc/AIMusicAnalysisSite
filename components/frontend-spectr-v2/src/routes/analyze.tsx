import { createFileRoute } from '@tanstack/react-router';

import { AnalyzePage } from '../features/anon-analyze/AnalyzePage';

// Story 6.3 — the anonymous instant-analysis funnel. Public: no auth guard;
// authed users can use it too (their upload still goes through the anon
// vertical — acceptable; the library flow is richer and linked in the chrome).
export const Route = createFileRoute('/analyze')({
  component: AnalyzePage,
});

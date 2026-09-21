import { createFileRoute } from '@tanstack/react-router';

import { ResultsForeverPage } from '../features/trust/pages/ResultsForeverPage';

// P7 (bundle diet) — the page component lives in features/trust/pages so
// the router's auto code-splitting can lazy-chunk it out of the entry
// bundle.
export const Route = createFileRoute('/trust/results-forever')({
  component: ResultsForeverPage,
});

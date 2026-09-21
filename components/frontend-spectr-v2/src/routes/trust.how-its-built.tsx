import { createFileRoute } from '@tanstack/react-router';

import { EngineeringPage } from '../features/engineering/EngineeringPage';

// Task P4 — the page component lives in features/engineering so the
// router's auto code-splitting can lazy-chunk it out of the entry bundle
// (same pattern as the other trust route files, e.g. trust.no-training.tsx).
export const Route = createFileRoute('/trust/how-its-built')({
  component: EngineeringPage,
});

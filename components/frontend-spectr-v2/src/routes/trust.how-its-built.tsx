import { createFileRoute } from '@tanstack/react-router';

import { HowItWorksPage } from '../features/how-it-works/HowItWorksPage';

// The page component lives in features/how-it-works so the router's auto
// code-splitting can lazy-chunk it out of the entry bundle (same pattern as
// the other trust route files, e.g. trust.no-training.tsx).
export const Route = createFileRoute('/trust/how-its-built')({
  component: HowItWorksPage,
});

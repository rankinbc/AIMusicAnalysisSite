import { createFileRoute } from '@tanstack/react-router';

import { FeaturesPage } from '../features/features-page/FeaturesPage';

// Public features page. The component lives in features/features-page so the
// router's auto code-splitting lazy-chunks it out of the entry bundle (same
// pattern as pricing.tsx).
export const Route = createFileRoute('/features')({
  component: FeaturesPage,
});

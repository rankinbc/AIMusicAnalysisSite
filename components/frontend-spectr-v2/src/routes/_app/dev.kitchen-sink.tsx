import { createFileRoute } from '@tanstack/react-router';

import { KitchenSinkPage } from '../../features/dev/KitchenSinkPage';

// P7 (bundle diet) — the page component lives in features/dev so the
// router's auto code-splitting can lazy-chunk it out of the entry bundle.
export const Route = createFileRoute('/_app/dev/kitchen-sink')({
  component: KitchenSinkPage,
});

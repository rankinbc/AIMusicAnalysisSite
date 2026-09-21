import { createFileRoute } from '@tanstack/react-router';

import { NoTrainingPage } from '../features/trust/pages/NoTrainingPage';

// P7 (bundle diet) — the page component lives in features/trust/pages so
// the router's auto code-splitting can lazy-chunk it out of the entry
// bundle. PLEDGE_VERSION stays re-exported here for anything that still
// resolves it from the route path.
export { PLEDGE_VERSION, PLEDGE_EFFECTIVE } from '../features/trust/pages/NoTrainingPage';

export const Route = createFileRoute('/trust/no-training')({
  component: NoTrainingPage,
});

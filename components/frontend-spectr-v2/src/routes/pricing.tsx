import { createFileRoute } from '@tanstack/react-router';

import { PricingPage } from '../features/pricing/PricingPage';

// Story 2.1 / UX-DR + UX-spec line 318 — public pricing route. Story 6.1:
// moved OUT of the _public layout (same /pricing path) so the slim
// PublicChrome renders instead of the narrow auth column. Task P2
// (public-surfaces-polish D7): the page itself now lives in
// features/pricing/ — this file is a thin shell so the route stays
// code-split from the rest of the app bundle.
export const Route = createFileRoute('/pricing')({
  component: PricingPage,
});

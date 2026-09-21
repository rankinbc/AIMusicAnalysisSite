import { createFileRoute } from '@tanstack/react-router';

import { AnalyzePage } from '../features/anon-analyze/AnalyzePage';

// Story 6.3 -> task G5 — the public instant-analysis funnel. No auth guard:
// a logged-out visitor's upload mints a capped 24-hour guest account and
// runs the SAME mix-upload path the signed-in "+ New song" flow uses (no
// separate anon vertical — that teaser flow is gone, see AnalyzePage.tsx); a
// signed-in real user who lands here is redirected to their library instead.
export const Route = createFileRoute('/analyze')({
  component: AnalyzePage,
});

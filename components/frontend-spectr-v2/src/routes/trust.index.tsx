import { createFileRoute, redirect } from '@tanstack/react-router';

// Story 6.2 (review finding) — a trimmed /trust URL must not 404 on a trust
// surface; the pledge is the natural front door.
export const Route = createFileRoute('/trust/')({
  beforeLoad: () => {
    throw redirect({ to: '/trust/no-training' });
  },
});

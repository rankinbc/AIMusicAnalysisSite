import { createFileRoute, redirect } from '@tanstack/react-router';

// Landing: authed users see /library, anonymous bounce to /login (via _app guard).
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/library' });
  },
});

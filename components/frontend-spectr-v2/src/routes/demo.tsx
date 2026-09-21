import { createFileRoute } from '@tanstack/react-router';

import { DemoLauncher } from '../features/demo/DemoLauncher';

// D9 — public, one-click guest sandbox entry. See DemoLauncher for the
// boot-refresh wait + startDemo + viewport-routed destination.
export const Route = createFileRoute('/demo')({
  component: DemoLauncher,
});

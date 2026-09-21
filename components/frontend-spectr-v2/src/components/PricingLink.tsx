/* Task P2 (public-surfaces-polish D6) — the ONE way a public page links to
 * /pricing. Renders nothing until the server has actually said credits are
 * on: hidden-by-default means the launch state (credits off) never flashes
 * a wrong link, and unknown (a failed /api/billing/plans read) hides too
 * rather than guessing. Plain <a> — same static-render-testable idiom as
 * PublicChrome. */
import type { ReactNode } from 'react';

import { useCreditsEnabled } from '../lib/public-plans';

export function PricingLink({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const creditsEnabled = useCreditsEnabled();
  if (creditsEnabled !== true) return null;
  return (
    <a href="/pricing" className={className}>
      {children ?? 'Pricing'}
    </a>
  );
}

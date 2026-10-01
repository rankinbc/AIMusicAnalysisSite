import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { UpgradeSheet } from '../../components/UpgradeSheet';

// Credit economy — ONE app-wide buy-credits surface. Paid buttons call
// useBuyCredits().open() when the user can't afford the action (labels-only
// rule: no confirm dialogs), and every 402 insufficient_credits lands here.

interface OpenOpts {
  title?: string;
  description?: string;
  onBought?: () => void;
}

const Ctx = createContext<{ open: (opts?: OpenOpts) => void }>({ open: () => {} });

// Hook lives beside its provider (brief); the lint rule is about fast-refresh only.
// eslint-disable-next-line react-refresh/only-export-components
export function useBuyCredits() {
  return useContext(Ctx);
}

export function BuyCreditsProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<OpenOpts | null>(null);
  const open = useCallback((o: OpenOpts = {}) => setOpts(o), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <UpgradeSheet
        open={opts !== null}
        onOpenChange={(o) => {
          if (!o) setOpts(null);
        }}
        title={opts?.title ?? 'Get more credits'}
        description={
          opts?.description ?? 'Credits never expire. Pick a pack, or go Pro for a monthly allowance.'
        }
        onUpgraded={() => {
          const done = opts?.onBought;
          setOpts(null);
          done?.();
        }}
      />
    </Ctx.Provider>
  );
}

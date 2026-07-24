import {
  MANIFEST,
  enabledModuleIds,
  moduleParams,
  readFixChain,
  type ModuleState,
  type RackChain,
} from './fix-rack-helpers';

// Pure helpers for the shared RackView / DeviceModule renderer — kept out of the
// component files so they fast-refresh (react-refresh/only-export-components).

export interface FlowNode {
  id: string;
  label: string;
  glyph: string;
  accent: string;
}

/** The enabled modules, in signal-chain order, resolved against the manifest for
 *  the "in › … › out" strip. Empty for a malformed/empty chain. */
export function signalFlowNodes(chain: unknown): FlowNode[] {
  return enabledModuleIds(chain).map((id) => {
    const man = MANIFEST.get(id);
    return {
      id,
      label: man?.label ?? id,
      glyph: man?.glyph ?? '·',
      accent: man?.accent ?? 'var(--muted)',
    };
  });
}

export { MANIFEST, enabledModuleIds, moduleParams, readFixChain };
export type { ModuleState, RackChain };

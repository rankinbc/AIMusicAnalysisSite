/* Listen Rack v2 — story 12.4 fix-rack carry-over (?fixPreset=) plus the
 * server draft restore/autosave that it sequences.
 *
 * These two are ONE concern: resolveDraftRestore takes carryPhase as an
 * input (a pending carry parks the restore; an applied carry arms autosave
 * WITHOUT restoring), so splitting them re-introduces the ordering bug E6.6
 * fixed. Moved verbatim out of ListenRackPage on 2026-09-19 to get that file
 * back under the line limit (spec D10) — no behaviour change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import type { Chain } from './chain';
import type { ModuleState } from './data';
import { overlayChain } from './fixToRackPatch';
import { clearFixOverlay } from './listenFixes';
import type { RackState } from './rackState';
import {
  asChain, resolveDraftRestore, useRackDraft, useRackDraftAutosave, useRackPreset,
} from './useRackPresets';

export type CarryPhase = 'none' | 'pending' | 'applied' | 'failed';

export interface FixCarryOver {
  /** Story 12.4: the carried-fix chip count. null = no carry. */
  fixesApplied: number | null;
  carryPhase: CarryPhase;
  onResetCarriedFixes: () => void;
}

export function useFixCarryOver({ versionId, fixPreset, realAudio, rsRef, currentChain }: {
  versionId: string | undefined;
  fixPreset: string | undefined;
  realAudio: boolean;
  /** The page's live rack-state ref — read only, never reassigned here. */
  rsRef: { current: RackState };
  currentChain: Chain;
}): FixCarryOver {
  const carryAllowedNow = Boolean(fixPreset && realAudio);
  const carryArmedRef = useRef<boolean | null>(null);
  if (carryArmedRef.current === null) carryArmedRef.current = carryAllowedNow;
  const carryArmed = Boolean(fixPreset) && carryArmedRef.current === true;
  const carriedPresetQuery = useRackPreset(
    realAudio ? (versionId ?? '') : '', carryArmed ? fixPreset : undefined);
  const [fixesApplied, setFixesApplied] = useState<number | null>(null);
  const [carryPhase, setCarryPhase] = useState<CarryPhase>(carryArmed ? 'pending' : 'none');
  const appliedPresetRef = useRef<string | null>(null); // one-shot per preset id
  const navigate = useNavigate();

  useEffect(() => {
    if (!fixPreset || appliedPresetRef.current === fixPreset) return;
    carryArmedRef.current = carryAllowedNow;
    if (carryArmedRef.current) setCarryPhase('pending');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm keys on the param only
  }, [fixPreset]);

  // Autosaved draft: restore once when it resolves, then debounced autosave.
  const draftQuery = useRackDraft(realAudio ? (versionId ?? '') : '');
  const {
    isError: draftIsError, isFetched: draftIsFetched, data: draftData,
    refetch: refetchDraft,
  } = draftQuery;
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    const decision = resolveDraftRestore({
      draftRestored, realAudio, carryPhase,
      isError: draftIsError, isFetched: draftIsFetched,
    });
    if (decision === 'wait') return;
    if (decision === 'pause') {
      toast.error("Couldn't load your saved rack draft — autosave is paused.", {
        id: 'rack-draft-load',
        action: { label: 'Retry', onClick: () => { void refetchDraft(); } },
      });
      return;
    }
    if (decision === 'restore') {
      const chain = draftData ? asChain(draftData.chain) : null;
      if (chain) {
        rsRef.current.recallPreset({
          id: 'draft', name: 'draft', by: 'you', order: chain.order,
          mod: chain.modules as Record<string, ModuleState>, n: 0,
        });
        rsRef.current.setMasterBypass(chain.masterBypass);
      }
    }
    setDraftRestored(true);
  }, [draftRestored, realAudio, carryPhase, draftIsError, draftIsFetched, draftData,
      refetchDraft, rsRef]);
  useRackDraftAutosave(versionId ?? '', currentChain, realAudio && draftRestored);

  // Apply the carried chain ONCE per preset id when it resolves.
  useEffect(() => {
    if (!carryArmed || !fixPreset || appliedPresetRef.current === fixPreset) return;
    if (carriedPresetQuery.isError) {
      appliedPresetRef.current = fixPreset;
      setCarryPhase('failed');
      toast.error('Could not load the carried fix rack — your saved draft is untouched.');
      return;
    }
    const dto = carriedPresetQuery.data;
    if (!dto) return; // still loading
    const chain = asChain(dto.chain);
    const applied = chain
      ? Object.entries(chain.modules).filter(([id, m]) => id !== 'pitch' && m?.enabled).length
      : 0;
    appliedPresetRef.current = fixPreset;
    if (!chain || applied === 0) {
      setCarryPhase('failed');
      toast.error('The carried fix rack could not be applied.');
      return;
    }
    rsRef.current.applyRackMod(overlayChain(rsRef.current.mod, chain.modules));
    rsRef.current.setMasterBypass(chain.masterBypass);
    setFixesApplied(applied);
    setCarryPhase('applied');
  }, [carryArmed, fixPreset, carriedPresetQuery.isError, carriedPresetQuery.data, rsRef]);

  const onResetCarriedFixes = useCallback(() => {
    rsRef.current.reset();
    if (versionId) clearFixOverlay(versionId);
    setFixesApplied(null);
    setCarryPhase('none');
    void navigate({
      to: '/listen-rack/$versionId',
      params: { versionId: versionId ?? '' },
      search: (prev: Record<string, unknown>) => {
        const rest = { ...prev };
        delete rest['fixPreset'];
        return rest;
      },
      replace: true,
    });
  }, [versionId, navigate, rsRef]);

  return { fixesApplied, carryPhase, onResetCarriedFixes };
}

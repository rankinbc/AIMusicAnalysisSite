/* SPECTR · Listen V3 (PRP-1) — server-backed rack presets + autosaved draft.
 *
 * The data layer behind the rack's Save/Presets seams. chain_json is the Listen
 * `Chain` currency (./chain). Presets are VERSION-scoped (owner derives via the
 * version), so every key hangs off versionId. JSON export/import is the
 * portability path (no server copy).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { fetcher } from '../../api/fetcher';
import type {
  RackDraftDto,
  RackPresetDto,
  SaveRackPresetRequest,
  UpsertRackDraftRequest,
} from '../../api/types';
import type { Chain } from './chain';
import type { ModuleState } from './data';

export const RACK_PRESET_SCHEMA_VERSION = 1;

// Export/import envelope — carries `name` so an exported preset round-trips to a
// named preset (raw chain_json alone would lose it). schemaVersion is advisory:
// apply tolerates manifest drift regardless (chainApply skips unknown modules).
export interface RackPresetEnvelope {
  name: string;
  source: string;
  chain: Chain;
  schemaVersion: number;
}

const presetsKey = (versionId: string) => ['versions', versionId, 'rack', 'presets'] as const;
const draftKey = (versionId: string) => ['versions', versionId, 'rack', 'draft'] as const;

// ── Validation (drift-tolerant, never throws here) ───────────────────────────
/** Narrow opaque JSON to a Chain, or null if it isn't shaped like one. */
export function asChain(value: unknown): Chain | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.order)) return null;
  if (typeof v.modules !== 'object' || v.modules === null) return null;
  return {
    order: v.order.filter((id): id is string => typeof id === 'string'),
    modules: v.modules as Partial<Record<string, ModuleState>>,
    masterBypass: v.masterBypass === true,
  };
}

/**
 * Parse + validate an exported envelope (or a bare chain) on import. Throws on
 * malformed JSON or a missing name/chain so the caller can surface a clear error.
 */
export function parseImportEnvelope(text: string): { name: string; chain: Chain } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Expected a preset object.');
  const obj = parsed as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) throw new Error('Preset is missing a name.');
  const chain = asChain(obj.chain);
  if (!chain) throw new Error('Preset is missing a valid chain (order + modules).');
  return { name, chain };
}

/** Build the export envelope for a named chain. */
export function buildExportEnvelope(name: string, chain: Chain, source = 'user'): RackPresetEnvelope {
  return { name, source, chain, schemaVersion: RACK_PRESET_SCHEMA_VERSION };
}

// ── Queries + mutations ──────────────────────────────────────────────────────
export function useRackPresets(versionId: string) {
  return useQuery({
    queryKey: presetsKey(versionId),
    queryFn: () => fetcher<RackPresetDto[]>({ url: `/versions/${versionId}/rack/presets`, method: 'GET' }),
    enabled: Boolean(versionId),
  });
}

/** Story 12.4: fetch ONE preset by id — any source (user/coach/analysis).
 *  The fix-rack carry-over (?fixPreset=) resolves its chain through this. */
export function useRackPreset(versionId: string, presetId: string | undefined) {
  return useQuery({
    queryKey: [...presetsKey(versionId), presetId] as const,
    queryFn: () =>
      fetcher<RackPresetDto>({ url: `/versions/${versionId}/rack/presets/${presetId}`, method: 'GET' }),
    enabled: Boolean(versionId && presetId),
    staleTime: Infinity, // generated preset is immutable per id
    retry: 1, // a bad/foreign id 404s — don't hammer
  });
}

export function useSaveRackPreset(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveRackPresetRequest) =>
      fetcher<RackPresetDto>({ url: `/versions/${versionId}/rack/presets`, method: 'POST', data: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: presetsKey(versionId) }),
    meta: { errorToast: 'Could not save the preset.' },
  });
}

export function useDeleteRackPreset(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (presetId: string) =>
      fetcher<void>({ url: `/versions/${versionId}/rack/presets/${presetId}`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: presetsKey(versionId) }),
    meta: { errorToast: 'Could not delete the preset.' },
  });
}

/** Get the autosaved draft — `null` when there is none yet (the server
 *  answers 204 and `fetcher` resolves `undefined`). TanStack Query rejects
 *  `undefined` data as an ERROR, which would pause autosave on every first
 *  visit, so "no draft" is mapped to `null`. */
export function useRackDraft(versionId: string) {
  return useQuery({
    queryKey: draftKey(versionId),
    queryFn: async (): Promise<RackDraftDto | null> =>
      (await fetcher<RackDraftDto | undefined>({ url: `/versions/${versionId}/rack/draft`, method: 'GET' })) ?? null,
    enabled: Boolean(versionId),
    staleTime: Infinity, // we own writes; no need to refetch in the background
  });
}

/** `keepalive` rides along for the pagehide flush only; it never reaches the wire body. */
export type RackDraftSave = UpsertRackDraftRequest & { keepalive?: boolean };

export function useUpsertRackDraft(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chain, keepalive }: RackDraftSave) =>
      fetcher<RackDraftDto>({
        url: `/versions/${versionId}/rack/draft`, method: 'PUT', data: { chain },
        ...(keepalive ? { keepalive: true } : {}),
      }),
    // The draft query is `staleTime: Infinity`, so a return visit inside gcTime
    // is served from this cache with no refetch. Nothing else writes the key:
    // without this the page restored the FIRST visit's draft over the saved one,
    // and the next autosave persisted that stale rack. Written before the PUT
    // settles because a quick round trip can beat it.
    onMutate: ({ chain }) => {
      qc.setQueryData<RackDraftDto | null>(draftKey(versionId), {
        songVersionId: versionId, chain, updatedAt: new Date().toISOString(),
      });
    },
    // E6.7 (draft half) — deliberately NOT meta.errorToast: the autosave fires
    // this on a 1.2 s debounce, so repeated failures would stack toasts. The
    // sonner `id` replaces the existing toast instead. Autosave stays ARMED —
    // only a failed draft GET disarms it (see resolveDraftRestore).
    onError: () =>
      toast.error('Draft not saving — your rack changes may not persist.', {
        id: 'rack-draft-save',
      }),
  });
}

// ── Draft-restore decision (E6.6) ────────────────────────────────────────────
export type DraftRestoreAction = 'wait' | 'arm' | 'pause' | 'restore';

/**
 * Pure decision for the page's one-shot draft-restore effect. Order matters:
 * the story-12.4 carry gates come first (a pending carry parks everything; an
 * applied carry arms autosave without restoring), then the GET-error PAUSE —
 * a failed draft GET must never let autosave overwrite the persisted draft
 * with defaults — then the fetch-settled check. 'restore' covers both a real
 * draft and a legitimate 204 no-draft (both arm autosave).
 */
export function resolveDraftRestore(s: {
  draftRestored: boolean;
  realAudio: boolean;
  carryPhase: 'none' | 'pending' | 'applied' | 'failed';
  isError: boolean;
  isFetched: boolean;
}): DraftRestoreAction {
  if (s.draftRestored || !s.realAudio) return 'wait';
  if (s.carryPhase === 'pending') return 'wait';
  if (s.carryPhase === 'applied') return 'arm';
  if (s.isError) return 'pause';
  if (!s.isFetched) return 'wait';
  return 'restore';
}

/**
 * Debounced rack-draft autosave. Calls the upsert mutation `delayMs` after the
 * chain last changed, so transient knob-drags don't spam the server. Skips the
 * very first render (the initial draft restore shouldn't echo straight back).
 * A change still waiting on the debounce is sent when the page unmounts or is
 * hidden — cancelling it there silently dropped the user's last edit.
 */
export function useRackDraftAutosave(
  versionId: string,
  chain: Chain,
  enabled: boolean,
  delayMs = 1200,
): void {
  const upsert = useUpsertRackDraft(versionId);
  const upsertRef = useRef(upsert);
  upsertRef.current = upsert;
  const skipFirst = useRef(true);
  const pendingRef = useRef<Chain | null>(null); // changed, not yet sent

  // Serialize so the effect only fires on a real content change.
  const serialized = JSON.stringify(chain);
  useEffect(() => {
    if (!enabled || !versionId) {
      pendingRef.current = null;
      return undefined;
    }
    if (skipFirst.current) {
      skipFirst.current = false;
      return undefined;
    }
    pendingRef.current = JSON.parse(serialized) as Chain;
    const id = setTimeout(() => {
      const chain = pendingRef.current;
      if (!chain) return; // a pagehide flush already sent it
      pendingRef.current = null;
      upsertRef.current.mutate({ chain });
    }, delayMs);
    return () => clearTimeout(id);
  }, [serialized, enabled, versionId, delayMs]);

  // Declared AFTER the debounce effect on purpose: on unmount React runs that
  // effect's cleanup (clearTimeout) first, then this one sends what it cancelled.
  useEffect(() => {
    const flush = (keepalive: boolean) => {
      const chain = pendingRef.current;
      if (!chain) return;
      pendingRef.current = null;
      upsertRef.current.mutate(keepalive ? { chain, keepalive: true } : { chain });
    };
    const onPageHide = () => flush(true);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      flush(false);
    };
  }, []);
}

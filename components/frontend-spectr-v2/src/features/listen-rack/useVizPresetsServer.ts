/* SPECTR · Listen V3 (PRP-1) — server-backed viz presets ("looks").
 *
 * Unlike rack presets, viz presets are USER-scoped (a look follows the producer
 * across versions/devices), so the key is global, not per-version. The viz_json
 * payload is the page's look bag: { viz, stages, director }.
 *
 * Note (PRP-1 G3): the pre-redesign localStorage viz path (`spectr.viz.presets.v1`)
 * never shipped in the listen-rack redesign — the current page held looks in React
 * state only — so there is nothing to one-time-import. New looks go straight to the
 * server; if a localStorage path is ever reintroduced, add the dedupe-by-name import
 * here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type { SaveVizPresetRequest, VizPresetDto } from '../../api/types';
import type { VizState } from './data';

// The persisted look. Mirrors the page's viz/stages/director trio.
export interface VizLook {
  viz: VizState;
  stages: string[];
  director: string;
}

const vizKey = ['viz', 'presets'] as const;

/** Narrow opaque viz_json to a VizLook, or null if it isn't shaped like one. */
export function asVizLook(value: unknown): VizLook | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.viz !== 'object' || v.viz === null) return null;
  return {
    viz: v.viz as VizState,
    stages: Array.isArray(v.stages) ? v.stages.filter((s): s is string => typeof s === 'string') : [],
    director: typeof v.director === 'string' ? v.director : '',
  };
}

export function useVizPresets() {
  return useQuery({
    queryKey: vizKey,
    queryFn: () => fetcher<VizPresetDto[]>({ url: '/viz/presets', method: 'GET' }),
  });
}

export function useSaveVizPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveVizPresetRequest) =>
      fetcher<VizPresetDto>({ url: '/viz/presets', method: 'POST', data: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: vizKey }),
    meta: { errorToast: 'Could not save the look.' },
  });
}

export function useDeleteVizPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (presetId: string) =>
      fetcher<void>({ url: `/viz/presets/${presetId}`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: vizKey }),
    meta: { errorToast: 'Could not delete the look.' },
  });
}

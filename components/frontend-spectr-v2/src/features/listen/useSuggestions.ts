/* SPECTR · Listen V3 (PRP-3) — reviewer suggestion hooks + client-side audition.
 * The proposed chain lives on the suggestion; accept forks it into the owner's
 * library (RackPreset). Audition is non-destructive: apply the chain to the live
 * graph via PRP-1's apply loop — there is NO audition endpoint. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type {
  CreateSuggestionRequest,
  RackPresetDto,
  SuggestionDto,
} from '../../api/types';

const suggestionsKey = (versionId: string) => ['versions', versionId, 'suggestions'] as const;
const presetsKey = (versionId: string) => ['versions', versionId, 'rack', 'presets'] as const;

export function useSuggestions(versionId: string) {
  return useQuery({
    queryKey: suggestionsKey(versionId),
    queryFn: () => fetcher<SuggestionDto[]>({ url: `/versions/${versionId}/suggestions`, method: 'GET' }),
    enabled: Boolean(versionId),
  });
}

export function useCreateSuggestion(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSuggestionRequest) =>
      fetcher<SuggestionDto>({ url: `/versions/${versionId}/suggestions`, method: 'POST', data: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: suggestionsKey(versionId) }),
  });
}

// Accept = fork-to-preset (owner). Returns the new RackPreset; invalidates the
// owner's preset library + the suggestion list (status → accepted).
export function useAcceptSuggestion(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) =>
      fetcher<RackPresetDto>({ url: `/suggestions/${suggestionId}/accept`, method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: suggestionsKey(versionId) });
      qc.invalidateQueries({ queryKey: presetsKey(versionId) });
    },
  });
}

export function useRejectSuggestion(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) =>
      fetcher<void>({ url: `/suggestions/${suggestionId}/reject`, method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: suggestionsKey(versionId) }),
  });
}

export function usePostAnonSuggestion(token: string) {
  return useMutation({
    mutationFn: (body: CreateSuggestionRequest) =>
      fetcher<SuggestionDto>({ url: `/v/${token}/suggestions`, method: 'POST', data: body }),
  });
}

// Story 11.12: the old graph-only `auditionSuggestion(graph, sg)` helper was
// retired — a graph-only apply leaves the rack knob UI showing stale values.
// Audition now goes through `listen-rack/suggest-draft.applySuggestionChain`
// (rs-based), which keeps React state and the audio graph in sync.

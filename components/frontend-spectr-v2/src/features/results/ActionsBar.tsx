import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { useSaveRackPreset } from '../listen-rack/useRackPresets';
import { combineFixes, fixWeight } from '../listen-rack/combineFixes';
import { RACK_MANIFEST } from '../listen-rack/data';
import { Icon } from './Icon';
import type { Move } from './move-model';
import { deviceOf } from './fix-board-helpers';

// Actions-tab toolbar (v4): Try Fixes · Create Preset · Coach Mix. Every action
// logs to the Improvement-Plan log (localStorage — stub policy). The queue
// itself is already in localStorage via ReportView's listenFixes effect, so
// "Try Fixes" is a plain navigate.

interface ActionsBarProps {
  versionId: string | null;
  trackName: string;
  committed: Move[];
  coachMixReady: boolean;
  coachMixGenerating: boolean;
  onGenerateCoachMix: () => void;
  onLogPlan: (kind: 'try_fixes' | 'create_preset' | 'coach_mix', label: string) => void;
}

export function ActionsBar({
  versionId,
  trackName,
  committed,
  coachMixReady,
  coachMixGenerating,
  onGenerateCoachMix,
  onLogPlan,
}: ActionsBarProps) {
  const navigate = useNavigate();
  const savePreset = useSaveRackPreset(versionId ?? '');
  const masterMoves = committed.filter(
    (m) => m.ops.length > 0 && deviceOf(m.scope) === 'Master',
  );

  const tryFixes = () => {
    if (!versionId || committed.length === 0) return;
    onLogPlan('try_fixes', `Try Fixes — ${committed.length} queued`);
    void navigate({ to: '/listen-rack/$versionId', params: { versionId }, search: {} });
  };

  const createPreset = () => {
    if (!versionId || masterMoves.length === 0) return;
    // Compile the queued MASTER-scope chains into one rack chain (device-scoped
    // moves belong to the DAW plan — recorded product decision). Weighted merge:
    // every queued fix contributes, weight = impact × confidence.
    const { mod: modules } = combineFixes(
      masterMoves.map((m) => ({ ops: m.ops, weight: fixWeight(m) })),
    );
    const chain = { order: RACK_MANIFEST.map((m) => m.id), modules, masterBypass: false };
    savePreset.mutate(
      { name: `Fixes — ${trackName}`.slice(0, 60), chain },
      {
        onSuccess: (p) => {
          toast.success(`Preset “${p.name}” saved.`);
          onLogPlan('create_preset', `Created preset from ${masterMoves.length} fixes`);
        },
      },
    );
  };

  return (
    <div className="ab-bar">
      <span className="ab-note mono">
        {committed.length > 0
          ? `${committed.length} queued`
          : 'queue fixes to unlock these'}
      </span>
      <span className="fbd-spacer" />
      <button
        type="button"
        className="fbd-ask gloss"
        disabled={!versionId || committed.length === 0}
        onClick={tryFixes}
      >
        <Icon name="play" size={12} />
        Try Fixes
        <span className="gtip">Toggle each queued fix live while listening on the rack.</span>
      </button>
      <button
        type="button"
        className="fbd-ask gloss"
        disabled={!versionId || masterMoves.length === 0 || savePreset.isPending}
        onClick={createPreset}
      >
        <Icon name="save" size={12} />
        Create Preset
        <span className="gtip">
          Combine the queued master-bus fixes into one saved rack preset ({masterMoves.length}{' '}
          applicable).
        </span>
      </button>
      <button
        type="button"
        className="fbd-ask green gloss"
        disabled={coachMixGenerating || coachMixReady || committed.length === 0}
        onClick={() => {
          onGenerateCoachMix();
          onLogPlan('coach_mix', 'Coach Mix requested');
        }}
      >
        {coachMixGenerating ? <span className="cmg-spin" /> : <Icon name="cassette" size={12} />}
        {coachMixReady ? 'Coach Mix ready' : coachMixGenerating ? 'Compiling…' : 'Coach Mix'}
        <span className="gtip">
          The Coach picks from your queue and compiles a single preset, with rationale.
        </span>
      </button>
    </div>
  );
}

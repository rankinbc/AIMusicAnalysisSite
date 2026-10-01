import type { FinalJson } from '../../../api/types';
import type { SongHeaderInputs } from '../SongHeader';

// Which inputs an analysis really ran on — drives the "Analyzed from" chips.
// The pipeline writes these phases for EVERY analysis, so their mere presence
// proves nothing: phase 4 always has a (possibly empty) `stems` object, phase
// 6's `gaps` is the genre comparison, and phase 8 exists as "skipped" without
// an .als. Only an explicit "ok" (or an uploaded file) counts.
export function analyzedInputs(
  files: ReadonlyArray<{ type: string }>,
  fj: FinalJson | undefined,
): SongHeaderInputs {
  const phase = (n: number) => fj?.phases?.find((p) => p.phase === n);
  const data = (n: number) => (phase(n)?.data ?? {}) as Record<string, unknown>;
  const stems = data(4).stems as { status?: string } | undefined;
  const hasFile = (type: string) => files.some((f) => f.type === type);

  return {
    mix: hasFile('mix') || files.length === 0,
    stems: hasFile('stem') || stems?.status === 'ok',
    als: hasFile('als') || (phase(8)?.status === 'ok' && Object.keys(data(8)).length > 0),
    reference: hasFile('reference') || data(5).status === 'ok',
  };
}

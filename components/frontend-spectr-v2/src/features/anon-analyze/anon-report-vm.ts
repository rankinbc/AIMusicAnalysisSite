/* Story 6.3 — normalized view model over the two anon-report sources so the
 * render component stays a pure component (react-refresh: no non-component
 * exports in the .tsx). The REDUCED anon projection (locked) and the FULL
 * authed report (after claim) both map here; `allFindings` is null until
 * claimed, so the locked view can only ever know a count. */
import type { FinalJson, JobResultsDto, Phase1Data } from '../../api/types';
import { isFinalJson } from '../../api/types';
import type { AnonReport } from './useAnonAnalysis';

export interface AnonReportVM {
  grade: string | null | undefined;
  score: number | undefined;
  danceability: number | undefined;
  phase1: Phase1Data | undefined;
  topFinding: string | null;
  totalFindings: number;
  allFindings: string[] | null;
  coachIntro: string | null;
}

function phase1Of(fj: FinalJson): Phase1Data | undefined {
  return fj.phases?.find((p) => p.phase === 1)?.data as Phase1Data | undefined;
}

export function vmFromAnon(r: AnonReport): AnonReportVM {
  const fj: FinalJson = isFinalJson(r.finalJson) ? (r.finalJson as FinalJson) : {};
  return {
    grade: fj.grade, score: fj.overall_score, danceability: fj.danceability_score,
    phase1: phase1Of(fj), topFinding: r.topFinding, totalFindings: r.totalFindings,
    allFindings: null, coachIntro: null,
  };
}

export function vmFromFull(results: JobResultsDto): AnonReportVM {
  const fj: FinalJson = isFinalJson(results.finalJson) ? (results.finalJson as FinalJson) : {};
  const all = fj.top_fixes ?? fj.coached_fixes ?? [];
  return {
    grade: fj.grade, score: fj.overall_score, danceability: fj.danceability_score,
    phase1: phase1Of(fj), topFinding: all[0] ?? null, totalFindings: all.length,
    allFindings: all, coachIntro: fj.coach_intro ?? null,
  };
}

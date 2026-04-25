import type { Verdict, SpecialistRoutingPlan } from "./verdicts";

export type VerdictEventKind =
  | "rule-verdict"
  | "routing-plan"
  | "verdict"
  | "validation-failure"
  | "specialist-error"
  | "complete"
  | "error";

export type VerdictEvent =
  | { kind: "rule-verdict"; payload: Verdict }
  | { kind: "routing-plan"; payload: SpecialistRoutingPlan }
  | { kind: "verdict"; payload: Verdict }
  | { kind: "validation-failure"; payload: { specialist: string; prompt_version: string; reason: string } }
  | { kind: "specialist-error"; payload: { specialist: string; error: string } }
  | { kind: "complete"; payload: { verdicts: Verdict[]; verdict_count: number; prompt_versions: string; model: string } }
  | { kind: "error"; payload: { error: string } };

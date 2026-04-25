import { useEffect, useRef, useState } from "react";
import type { Verdict, SpecialistRoutingPlan } from "../../types/verdicts";

type Status = "idle" | "streaming" | "complete" | "error";

export interface VerdictStreamState {
  status: Status;
  ruleVerdicts: Verdict[];
  routingPlan: SpecialistRoutingPlan | null;
  specialistVerdicts: Verdict[];
  finalVerdicts: Verdict[];
  error: string | null;
  validationFailures: { specialist: string; reason: string }[];
}

export function useVerdictStream(jobId: string, sseToken: string): VerdictStreamState {
  const [state, setState] = useState<VerdictStreamState>({
    status: "idle",
    ruleVerdicts: [],
    routingPlan: null,
    specialistVerdicts: [],
    finalVerdicts: [],
    error: null,
    validationFailures: [],
  });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `/api/reports/${jobId}/verdicts/stream?token=${encodeURIComponent(sseToken)}`;
    const es = new EventSource(url, { withCredentials: false });
    esRef.current = es;
    setState(s => ({ ...s, status: "streaming" }));

    const parse = (e: MessageEvent): unknown => {
      try { return JSON.parse(e.data); } catch { return null; }
    };

    es.addEventListener("rule-verdict", (e) => {
      const v = parse(e as MessageEvent) as Verdict | null;
      if (v) setState(s => ({ ...s, ruleVerdicts: [...s.ruleVerdicts, v] }));
    });
    es.addEventListener("routing-plan", (e) => {
      const p = parse(e as MessageEvent) as SpecialistRoutingPlan | null;
      if (p) setState(s => ({ ...s, routingPlan: p }));
    });
    es.addEventListener("verdict", (e) => {
      const v = parse(e as MessageEvent) as Verdict | null;
      if (v) setState(s => ({
        ...s, specialistVerdicts: [...s.specialistVerdicts, v]
      }));
    });
    es.addEventListener("validation-failure", (e) => {
      const f = parse(e as MessageEvent) as { specialist: string; reason: string } | null;
      if (f) setState(s => ({
        ...s, validationFailures: [...s.validationFailures, f]
      }));
    });
    es.addEventListener("complete", (e) => {
      const p = parse(e as MessageEvent) as { verdicts: Verdict[] } | null;
      setState(s => ({
        ...s,
        status: "complete",
        finalVerdicts: p?.verdicts ?? s.specialistVerdicts,
      }));
      es.close();
    });
    es.addEventListener("error", (e) => {
      const p = parse(e as MessageEvent) as { error: string } | null;
      setState(s => ({
        ...s, status: "error", error: p?.error ?? "stream error"
      }));
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId, sseToken]);

  return state;
}

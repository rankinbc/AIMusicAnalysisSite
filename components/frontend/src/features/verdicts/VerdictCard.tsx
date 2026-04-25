import { useState } from "react";
import type { Verdict } from "../../types/verdicts";
import { SeverityBadge } from "./SeverityBadge";
import { EvidenceChips } from "./EvidenceChips";
import { FixSummary } from "./FixSummary";
import { dismissVerdict, sendFeedback } from "./feedbackClient";

const SEVERITY_BORDER: Record<Verdict["severity"], string> = {
  critical: "border-red-600",
  severe:   "border-orange-600",
  moderate: "border-yellow-600",
  minor:    "border-blue-600",
  win:      "border-green-600",
};

const SPECIALIST_LABELS: Record<string, string> = {
  rule_engine: "Rule engine",
  low_end: "Low End",
  frequency_balance: "Frequency Balance",
  dynamics: "Dynamics",
  stereo_phase: "Stereo & Phase",
  loudness: "Loudness",
  sections: "Sections",
  trance_arrangement: "Trance Arrangement",
  stem_reference: "Stem Reference",
  harmonic: "Harmonic",
  clarity: "Clarity",
  spatial: "Spatial",
  surround: "Surround",
  playback: "Playback",
  overall: "Overall",
  gain_staging: "Gain Staging",
  stereo_field: "Stereo Field",
  frequency_collision: "Frequency Collision",
  humanization: "Humanization",
  section_contrast: "Section Contrast",
  density: "Density",
  chord_harmony: "Chord & Harmony",
  device_chain: "Device Chain",
  priority_summary: "Priority Summary",
};

interface Props {
  verdict: Verdict;
  onDismiss?: (id: string) => void;
}

export function VerdictCard({ verdict, onDismiss }: Props) {
  const [showWhy, setShowWhy] = useState(false);
  const [dismissed, setDismissed] = useState(verdict.user_state.dismissed);
  const [feedback, setFeedback] = useState(verdict.user_state.feedback);

  if (dismissed) return null;

  const border = SEVERITY_BORDER[verdict.severity];
  const pulse = verdict.severity === "critical" ? "animate-pulse" : "";
  const label = SPECIALIST_LABELS[verdict.specialist] ?? verdict.specialist;

  const handleDismiss = async () => {
    setDismissed(true);
    onDismiss?.(verdict.verdict_id);
    try { await dismissVerdict(verdict.verdict_id); } catch { /* swallow */ }
  };

  const handleFeedback = async (kind: "helpful" | "wrong" | "unclear") => {
    setFeedback(kind);
    try { await sendFeedback(verdict.verdict_id, kind); } catch { /* swallow */ }
  };

  return (
    <article
      className={`border-l-4 ${border} bg-white rounded-md shadow-sm p-4 ${pulse}`}
      data-testid={`verdict-${verdict.verdict_id}`}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={verdict.severity} />
          <span className="text-xs text-slate-500">{label}</span>
        </div>
        {verdict.confidence < 0.7 && (
          <span className="text-xs text-slate-500">
            confidence {Math.round(verdict.confidence * 100)}%
          </span>
        )}
      </header>

      <h3 className="font-semibold text-slate-900 mt-2">{verdict.headline}</h3>
      <p className="text-sm text-slate-700 mt-1">{verdict.summary}</p>

      <EvidenceChips evidence={verdict.evidence} />
      <FixSummary fix={verdict.fix} />

      <button
        type="button"
        onClick={() => setShowWhy(s => !s)}
        className="mt-3 text-xs text-slate-500 hover:text-slate-800"
      >
        {showWhy ? "▾" : "▸"} Why this matters
      </button>
      {showWhy && (
        <p className="text-xs text-slate-600 mt-1">{verdict.why_it_matters}</p>
      )}

      <footer className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={() => handleFeedback("helpful")}
          className={`text-xs px-2 py-1 rounded ${feedback === "helpful" ? "bg-green-100 text-green-900" : "text-slate-500 hover:bg-slate-100"}`}
        >👍 Helpful</button>
        <button
          type="button"
          onClick={() => handleFeedback("wrong")}
          className={`text-xs px-2 py-1 rounded ${feedback === "wrong" ? "bg-red-100 text-red-900" : "text-slate-500 hover:bg-slate-100"}`}
        >👎 Wrong</button>
        <button
          type="button"
          onClick={() => handleFeedback("unclear")}
          className={`text-xs px-2 py-1 rounded ${feedback === "unclear" ? "bg-yellow-100 text-yellow-900" : "text-slate-500 hover:bg-slate-100"}`}
        >❓ Unclear</button>
        <button
          type="button"
          onClick={handleDismiss}
          className="ml-auto text-xs text-slate-400 hover:text-slate-700"
        >✕ Dismiss</button>
      </footer>
    </article>
  );
}

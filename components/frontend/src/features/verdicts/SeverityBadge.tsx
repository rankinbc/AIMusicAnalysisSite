import type { Severity } from "../../types/verdicts";

const STYLES: Record<Severity, { label: string; classes: string; icon: string }> = {
  critical: { label: "CRITICAL", classes: "bg-red-50 border-red-600 text-red-900", icon: "🔴" },
  severe:   { label: "SEVERE",   classes: "bg-orange-50 border-orange-600 text-orange-900", icon: "🟠" },
  moderate: { label: "MODERATE", classes: "bg-yellow-50 border-yellow-600 text-yellow-900", icon: "🟡" },
  minor:    { label: "MINOR",    classes: "bg-blue-50 border-blue-600 text-blue-900", icon: "🔵" },
  win:      { label: "WIN",      classes: "bg-green-50 border-green-600 text-green-900", icon: "✅" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = STYLES[severity];
  return (
    <span className={`inline-flex items-center gap-1 border px-2 py-0.5 rounded text-xs font-semibold ${s.classes}`}>
      <span>{s.icon}</span>
      <span>{s.label}</span>
    </span>
  );
}

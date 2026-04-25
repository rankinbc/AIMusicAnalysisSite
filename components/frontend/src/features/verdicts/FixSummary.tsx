import type { Fix, DspOp } from "../../types/verdicts";

function describeOp(op: DspOp): string {
  const p = op.params as Record<string, number | string>;
  switch (op.type) {
    case "peaking_eq":
      return `Peaking EQ: ${(p.gain_db as number) >= 0 ? "+" : ""}${p.gain_db}dB at ${p.frequency_hz}Hz Q=${p.q}`;
    case "low_shelf":
      return `Low shelf: ${(p.gain_db as number) >= 0 ? "+" : ""}${p.gain_db}dB at ${p.frequency_hz}Hz`;
    case "high_shelf":
      return `High shelf: ${(p.gain_db as number) >= 0 ? "+" : ""}${p.gain_db}dB at ${p.frequency_hz}Hz`;
    case "high_pass":
      return `High-pass at ${p.frequency_hz}Hz, ${p.slope_db}dB/oct`;
    case "low_pass":
      return `Low-pass at ${p.frequency_hz}Hz, ${p.slope_db}dB/oct`;
    case "compressor":
      return `Compressor: ${p.threshold_db}dB threshold, ${p.ratio}:1 ratio, ${p.attack_ms}ms attack, ${p.release_ms}ms release`;
    case "multiband_compressor": {
      const bands = p.bands as unknown;
      const count = Array.isArray(bands) ? bands.length : 0;
      return `Multiband compressor (${count} bands)`;
    }
    case "limiter":
      return `Limiter: ${p.ceiling_db}dB ceiling, ${p.release_ms}ms release`;
    case "gain":
      return `Gain: ${(p.gain_db as number) >= 0 ? "+" : ""}${p.gain_db}dB`;
    case "stereo_width":
      return `Stereo width: ${p.width_pct}%`;
    case "sidechain":
      return `Sidechain from ${p.source_stem}: -${p.depth_db}dB depth, ${p.release_ms}ms release`;
    default:
      return `Unknown op: ${(op as DspOp).type}`;
  }
}

export function FixSummary({ fix }: { fix: Fix | null }) {
  if (!fix) return null;
  const target = `${fix.target.type}: ${fix.target.name}`;
  const section = fix.section
    ? ` (${fix.section.section_type ?? "section"} ${fix.section.start_seconds.toFixed(0)}–${fix.section.end_seconds.toFixed(0)}s)`
    : "";
  return (
    <div className="mt-3 p-3 bg-slate-50 border-l-2 border-slate-400 rounded">
      <div className="text-xs font-semibold text-slate-600 mb-1">
        Recommended fix on {target}{section}
      </div>
      <ul className="text-sm space-y-1">
        {fix.dsp_chain.map((op, i) => (
          <li key={i} className="text-slate-800">• {describeOp(op)}</li>
        ))}
        {fix.sidechain && (
          <li className="text-slate-800">
            • Sidechain {fix.target.name} to {fix.sidechain.source_stem}:
            -{fix.sidechain.depth_db}dB, {fix.sidechain.release_ms}ms release
          </li>
        )}
      </ul>
      <div className="text-xs text-slate-600 mt-2 italic">
        {fix.expected_outcome}
      </div>
    </div>
  );
}

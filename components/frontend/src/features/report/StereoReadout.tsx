interface Props {
  correlation: number | null
  stereoWidth: number | null
  monoCompatibility: number | null
}

interface RowProps {
  label: string
  sublabel: string
  value: number | null
  format: (v: number) => string
  thresholds: [number, number]  // [warn, ok]
  invertThresholds?: boolean    // for correlation: higher is ok
}

function qualityColor(value: number, thresholds: [number, number], invert: boolean): string {
  const [warn, ok] = thresholds
  if (invert) {
    if (value >= ok) return '#4ade80'
    if (value >= warn) return '#facc15'
    return '#f87171'
  } else {
    if (value <= ok) return '#4ade80'
    if (value <= warn) return '#facc15'
    return '#f87171'
  }
}

function qualityLabel(value: number, thresholds: [number, number], invert: boolean, labels: string[]): string {
  const [warn, ok] = thresholds
  if (invert) {
    if (value >= ok) return labels[0]
    if (value >= warn) return labels[1]
    return labels[2]
  } else {
    if (value <= ok) return labels[0]
    if (value <= warn) return labels[1]
    return labels[2]
  }
}

function DotBar({ value, color }: { value: number; color: string }) {
  const filled = Math.round(value * 5)
  return (
    <div className="flex gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="h-2 w-2 rounded-full transition-colors"
          style={{ backgroundColor: i < filled ? color : '#1c1c38' }}
        />
      ))}
    </div>
  )
}

function Row({ label, sublabel, value, format, thresholds, invertThresholds = true }: RowProps) {
  if (value == null) return null
  const color = qualityColor(value, thresholds, invertThresholds)
  const statusLabel = qualityLabel(
    value, thresholds, invertThresholds,
    ['Excellent', 'Check', 'Problem']
  )
  const normalizedDots = invertThresholds ? value : 1 - value

  return (
    <div className="flex items-center gap-4 py-3 border-b border-studio-border last:border-0">
      <div className="w-28 shrink-0">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-studio-muted">{sublabel}</p>
      </div>
      <DotBar value={Math.max(0, Math.min(1, normalizedDots))} color={color} />
      <div className="ml-auto text-right">
        <span className="font-metric text-sm" style={{ color }}>{format(value)}</span>
        <p className="text-xs" style={{ color: `${color}99` }}>{statusLabel}</p>
      </div>
    </div>
  )
}

export default function StereoReadout({ correlation, stereoWidth, monoCompatibility }: Props) {
  if (correlation == null && stereoWidth == null && monoCompatibility == null) return null

  return (
    <div className="rounded-xl border border-studio-border bg-studio-card p-5">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-studio-muted">Stereo Health</h2>

      <Row
        label="Correlation"
        sublabel="L/R phase agreement"
        value={correlation}
        format={(v) => v.toFixed(2)}
        thresholds={[0.5, 0.8]}
        invertThresholds={true}
      />
      <Row
        label="Width"
        sublabel="Stereo spread"
        value={stereoWidth != null ? Math.min(1, stereoWidth / 0.3) : null}
        format={(_normalized) => stereoWidth != null ? stereoWidth.toFixed(3) : '—'}
        thresholds={[0.2, 0.4]}
        invertThresholds={true}
      />
      <Row
        label="Mono Compat"
        sublabel="Survives mono fold"
        value={monoCompatibility}
        format={(v) => `${Math.round(v * 100)}%`}
        thresholds={[0.5, 0.7]}
        invertThresholds={true}
      />
    </div>
  )
}

interface ALSTrack {
  name: string
  type: string
  device_count: number
  disabled_count: number
  muted: boolean
}

interface ALSMidiIssue {
  track: string
  clip: string | null
  type: string
  severity: string
  description: string
  fix: string
}

interface ALSSection {
  name: string
  start_beat: number
  end_beat: number
  duration_bars: number
}

interface ALSData {
  health_score: number
  grade: string
  tempo: number
  ableton_version: string
  time_signature: string
  total_devices: number
  disabled_devices: number
  clutter_pct: number
  tracks: ALSTrack[]
  midi: {
    total_clips: number
    total_notes: number
    empty_clips: number
    short_clips: number
    duplicate_clips: number
    tracks_without_content: number
    issues: ALSMidiIssue[]
  }
  arrangement: {
    has_markers: boolean
    total_sections: number
    pattern: string | null
    sections: ALSSection[]
  }
}

interface Props {
  data: ALSData
}

function GradeChip({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: 'bg-green-500/20 text-green-400',
    B: 'bg-blue-500/20 text-blue-400',
    C: 'bg-yellow-500/20 text-yellow-400',
    D: 'bg-orange-500/20 text-orange-400',
    F: 'bg-red-500/20 text-red-400',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-bold ${colors[grade] ?? 'bg-zinc-700 text-zinc-300'}`}>
      {grade}
    </span>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    warning: 'bg-orange-500/20 text-orange-400',
    suggestion: 'bg-blue-500/20 text-blue-400',
    critical: 'bg-red-500/20 text-red-400',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors[severity] ?? 'bg-zinc-700 text-zinc-400'}`}>
      {severity}
    </span>
  )
}

export function ALSAnalysis({ data }: Props) {
  return (
    <section className="mt-8 space-y-6">
      <h2 className="text-lg font-semibold text-zinc-100">ALS Project Analysis</h2>

      {/* Health Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-1">Health</p>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-zinc-100">{data.health_score}</span>
            <GradeChip grade={data.grade} />
          </div>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-1">Tempo</p>
          <p className="text-xl font-bold text-zinc-100">{data.tempo} <span className="text-sm font-normal text-zinc-400">BPM</span></p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-1">Devices</p>
          <p className="text-xl font-bold text-zinc-100">{data.total_devices}</p>
          {data.clutter_pct > 0 && (
            <p className="text-xs text-zinc-500">{data.clutter_pct}% disabled</p>
          )}
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-1">MIDI Notes</p>
          <p className="text-xl font-bold text-zinc-100">{data.midi.total_notes.toLocaleString()}</p>
          <p className="text-xs text-zinc-500">{data.midi.total_clips} clips</p>
        </div>
      </div>

      {/* MIDI Stats */}
      <div className="bg-zinc-800/60 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">MIDI Stats</h3>
        <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-400">Empty clips</span>
            <span className={data.midi.empty_clips > 0 ? 'text-orange-400' : 'text-zinc-300'}>{data.midi.empty_clips}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Short clips</span>
            <span className={data.midi.short_clips > 0 ? 'text-yellow-400' : 'text-zinc-300'}>{data.midi.short_clips}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Duplicates</span>
            <span className={data.midi.duplicate_clips > 0 ? 'text-blue-400' : 'text-zinc-300'}>{data.midi.duplicate_clips}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Empty tracks</span>
            <span className={data.midi.tracks_without_content > 0 ? 'text-orange-400' : 'text-zinc-300'}>{data.midi.tracks_without_content}</span>
          </div>
        </div>
        {data.midi.issues.length > 0 && (
          <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
            {data.midi.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-zinc-400">
                <SeverityBadge severity={issue.severity} />
                <div>
                  <span className="text-zinc-300">{issue.track}{issue.clip ? ` / ${issue.clip}` : ''}</span>
                  {' — '}{issue.description}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Arrangement */}
      {data.arrangement.has_markers && data.arrangement.sections.length > 0 && (
        <div className="bg-zinc-800/60 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-1">Arrangement</h3>
          {data.arrangement.pattern && (
            <p className="text-xs text-zinc-500 mb-3">Pattern: {data.arrangement.pattern}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {data.arrangement.sections.map((s, i) => (
              <div key={i} className="bg-zinc-700/50 rounded px-3 py-1.5 text-xs">
                <span className="text-zinc-200 font-medium">{s.name}</span>
                <span className="text-zinc-500 ml-1">{s.duration_bars} bars</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Track Inventory */}
      <div className="bg-zinc-800/60 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Track Inventory ({data.tracks.length})</h3>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {data.tracks.map((track, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-10 text-zinc-500 capitalize">{track.type.slice(0, 4)}</span>
              <span className={`flex-1 ${track.muted ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>
                {track.name}
              </span>
              {track.device_count > 0 && (
                <span className="text-zinc-600">{track.device_count} fx</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

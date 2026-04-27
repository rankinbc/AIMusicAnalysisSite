import { useState, useEffect, useCallback } from 'react';
import { getALSProject } from '../api/alsProject.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const TRACK_COLORS = {
  midi:   'var(--cyan)',
  audio:  '#a78bfa',
  return: 'var(--orange)',
  group:  'var(--yellow)',
  master: 'var(--green)',
};

const DEVICE_TYPE_LABEL = {
  native:       null,          // no badge — most common
  vst:          'VST',
  max_for_live: 'M4L',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtValue(key, val) {
  if (typeof val === 'boolean') return val ? 'on' : 'off';
  if (typeof val === 'number') {
    const abs = Math.abs(val);
    if (abs === 0) return '0';
    if (Number.isInteger(val) || abs >= 100) return val.toFixed(0);
    if (abs < 0.01) return val.toExponential(2);
    return val.toFixed(2);
  }
  return String(val);
}

function fmtParamName(key) {
  // CamelCase → "Camel Case"
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

// ── Param table ───────────────────────────────────────────────────────────────

function ParamTable({ params }) {
  const entries = Object.entries(params);
  if (entries.length === 0) {
    return (
      <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', padding: '6px 0' }}>
        no readable parameters
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px', marginTop: 8 }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fmtParamName(k)}
          </span>
          <span className="mono" style={{
            fontSize: 10, flexShrink: 0,
            color: typeof v === 'boolean' ? (v ? 'var(--green)' : 'var(--dim)') : 'var(--text)',
          }}>
            {fmtValue(k, v)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Device row ────────────────────────────────────────────────────────────────

function DeviceRow({ device }) {
  const [open, setOpen] = useState(false);
  const badge = DEVICE_TYPE_LABEL[device.device_type];
  const hasParams = Object.keys(device.params ?? {}).length > 0;

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <div
        onClick={() => hasParams && setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 14px 6px 28px',
          cursor: hasParams ? 'pointer' : 'default',
          opacity: device.enabled ? 1 : 0.4,
        }}
      >
        {/* Enabled dot */}
        <div style={{
          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
          background: device.enabled ? 'var(--cyan)' : 'var(--dim)',
        }} />

        <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>
          {device.name}
        </span>

        {badge && (
          <span className="mono" style={{
            fontSize: 9, color: 'var(--muted)', padding: '1px 5px',
            border: '1px solid var(--border)', borderRadius: 3,
          }}>
            {badge}
          </span>
        )}

        {hasParams && (
          <span style={{ color: 'var(--dim)', fontSize: 10, userSelect: 'none' }}>
            {open ? '▲' : '▼'}
          </span>
        )}
      </div>

      {open && hasParams && (
        <div style={{
          padding: '4px 14px 10px 42px',
          background: 'rgba(0,0,0,0.18)',
          borderTop: '1px solid rgba(255,255,255,0.03)',
        }}>
          <ParamTable params={device.params} />
        </div>
      )}
    </div>
  );
}

// ── Track row ─────────────────────────────────────────────────────────────────

function TrackRow({ track }) {
  const [open, setOpen] = useState(false);
  const color = TRACK_COLORS[track.type] ?? 'var(--muted)';

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${color}`,
      borderRadius: 7,
      overflow: 'hidden',
      background: 'var(--surface)',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 14px', cursor: 'pointer',
          opacity: track.muted ? 0.45 : 1,
          background: open ? 'rgba(255,255,255,0.02)' : 'transparent',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {track.name}
            </span>
            {track.muted && (
              <span className="mono" style={{ fontSize: 9, color: 'var(--orange)', flexShrink: 0 }}>MUTED</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
            <span className="mono" style={{ fontSize: 9, color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {track.type}
            </span>
            {track.devices.length > 0 && (
              <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>
                {track.devices.length} device{track.devices.length !== 1 ? 's' : ''}
              </span>
            )}
            {track.clip_count > 0 && (
              <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>
                {track.clip_count} clip{track.clip_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
          <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>
            {track.volume_db >= 0 ? '+' : ''}{track.volume_db} dB
          </span>
          {track.pan !== 0 && (
            <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>
              {track.pan > 0 ? `R${(track.pan * 100).toFixed(0)}` : `L${(-track.pan * 100).toFixed(0)}`}
            </span>
          )}
        </div>

        <span style={{ color: 'var(--dim)', fontSize: 11, userSelect: 'none', marginLeft: 4 }}>
          {open ? '▲' : '▼'}
        </span>
      </div>

      {/* Device list */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {track.devices.length === 0 ? (
            <div className="mono" style={{ padding: '10px 28px', fontSize: 10, color: 'var(--dim)' }}>
              no devices
            </div>
          ) : (
            track.devices.map((device, i) => (
              <DeviceRow key={i} device={device} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ALSProjectPanel({ jobId }) {
  const [state,    setState]    = useState('loading');  // loading | done | none | error
  const [project,  setProject]  = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [filter,   setFilter]   = useState('all');       // all | midi | audio | return

  useEffect(() => {
    getALSProject(jobId).then(data => {
      if (data === null) { setState('none'); return; }
      setProject(data);
      setState('done');
    }).catch(() => setState('error'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'none' || state === 'error') return null;

  const tracks = project?.tracks ?? [];
  const visible = filter === 'all' ? tracks : tracks.filter(t => t.type === filter);

  return (
    <div style={{
      height: expanded ? 560 : 52,
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      marginBottom: 20,
      transition: 'height 0.35s cubic-bezier(0.16,1,0.3,1)',
    }}>

      {/* ── Header ── */}
      <div
        onClick={() => state === 'done' && setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 18px', height: 52, flexShrink: 0,
          cursor: state === 'done' ? 'pointer' : 'default',
          borderBottom: expanded ? '1px solid var(--border)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--orange)', boxShadow: '0 0 8px var(--orange)',
          }} />
          <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 12, letterSpacing: '0.18em', color: 'var(--orange)' }}>
            ABLETON PROJECT
          </span>
          {state === 'loading' && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>loading…</span>
          )}
          {state === 'done' && project && (
            <>
              <span className="mono" style={{ fontSize: 9, color: 'var(--muted)', padding: '2px 8px', borderRadius: 99, background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)' }}>
                {project.track_count} tracks
              </span>
              <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>
                {project.tempo} BPM · {project.time_signature}
              </span>
            </>
          )}
        </div>
        {state === 'done' && (
          <span style={{ color: 'var(--dim)', fontSize: 13 }}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      {/* ── Body ── */}
      {expanded && state === 'done' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Filter strip */}
          <div style={{
            display: 'flex', gap: 6, padding: '8px 18px',
            borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            {['all', 'midi', 'audio', 'return'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? 'rgba(251,146,60,0.12)' : 'none',
                  border: `1px solid ${filter === f ? 'rgba(251,146,60,0.4)' : 'var(--border)'}`,
                  color: filter === f ? 'var(--orange)' : 'var(--muted)',
                  fontSize: 10, padding: '3px 10px', borderRadius: 5,
                  cursor: 'pointer', fontFamily: 'Syne', textTransform: 'capitalize',
                }}
              >{f}</button>
            ))}
            <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginLeft: 'auto', alignSelf: 'center' }}>
              {project.ableton_version}
            </span>
          </div>

          {/* Track list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visible.length === 0 ? (
              <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', textAlign: 'center', padding: 20 }}>
                no {filter} tracks
              </div>
            ) : (
              visible.map((track, i) => <TrackRow key={i} track={track} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

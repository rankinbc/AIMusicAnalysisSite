import { useEffect, useMemo, useState } from 'react';

import type { VerdictDspOp, VerdictDto } from '../../api/types';
import { Icon, type IconName } from './Icon';
import { SEVERITY_RANK, severityColor, severityLabel } from './helpers/severity';
import { SPECIALIST_CATALOG, specialistGroup, type SpecialistGroup } from './helpers/specialists';
import type { Move } from './move-model';

// Findings master-detail board (prototype `.fixboard`): a dense severity-grouped
// list on the left, the selected finding's full detail + fix on the right. This
// is the body of the (relabeled) "Findings" tab. Queueing a fix drives the
// Send-to-Listen count.

const SEV_ORDER = ['critical', 'severe', 'moderate', 'minor', 'win'] as const;
type Sev = (typeof SEV_ORDER)[number];

// One of the 7 display groups: prefer the specialist's group, else infer from
// the category so rule-engine findings still slot in (mirrors FindingsTab).
function groupForVerdict(v: VerdictDto): SpecialistGroup {
  const g = specialistGroup(v.specialist);
  if (g) return g;
  const c = `${v.category} ${v.specialist}`.toLowerCase();
  if (/lufs|loud|peak|clip|gain|stream/.test(c)) return 'Loudness';
  if (/stereo|width|mono|phase|spatial|surround/.test(c)) return 'Stereo';
  if (/section|arrange|structure|contrast/.test(c)) return 'Sections';
  if (/stem/.test(c)) return 'Stems';
  if (/dynamic|transient|density|humaniz/.test(c)) return 'Dynamics';
  if (/freq|spectr|band|low_end|low-end|tonal|mud|air|clarity|harmonic|balance/.test(c))
    return 'Spectrum';
  return 'Misc';
}

function sevTitle(sev: string): string {
  const label = severityLabel(sev);
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

function specName(v: VerdictDto): string {
  const known = SPECIALIST_CATALOG.find((x) => x.slug === v.specialist);
  if (known) return known.label;
  return (v.category || 'Measured')
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Device glyph + accent per rack module type — a subset of the Listen-rack
// vocabulary, matching the prototype's AR_MOD_META. Unknown types fall back to
// the neutral sliders glyph so a chain always renders.
const MODULE_META: Record<string, { icon: IconName; accent: string }> = {
  eq: { icon: 'sliders', accent: 'var(--accent)' },
  djfilter: { icon: 'sliders', accent: 'var(--blue)' },
  filter: { icon: 'sliders', accent: 'var(--blue)' },
  comp: { icon: 'pulse', accent: 'var(--blue)' },
  compressor: { icon: 'pulse', accent: 'var(--blue)' },
  gate: { icon: 'target', accent: 'var(--blue)' },
  sat: { icon: 'wave', accent: 'var(--yellow)' },
  saturation: { icon: 'wave', accent: 'var(--yellow)' },
  bitcrusher: { icon: 'collision', accent: 'var(--orange)' },
  width: { icon: 'spatial', accent: 'var(--violet)' },
  pan: { icon: 'spatial', accent: 'var(--violet)' },
  tremolo: { icon: 'pulse', accent: 'var(--violet)' },
  delay: { icon: 'clock', accent: 'var(--blue)' },
  reverb: { icon: 'spatial', accent: 'var(--violet)' },
  limiter: { icon: 'bolt', accent: 'var(--orange)' },
  trim: { icon: 'sliders', accent: 'var(--muted)' },
  gain: { icon: 'sliders', accent: 'var(--muted)' },
  pitch: { icon: 'music', accent: 'var(--green)' },
};

function moduleMeta(type: string): { icon: IconName; accent: string } {
  return MODULE_META[type.toLowerCase()] ?? { icon: 'sliders', accent: 'var(--accent)' };
}

function formatParam(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (v === null || v === undefined) return '';
  return String(v);
}

function RackModule({ op }: { op: VerdictDspOp }) {
  const meta = moduleMeta(op.type);
  const entries = Object.entries(op.params ?? {});
  return (
    <div className="rackmod" style={{ ['--ac' as string]: meta.accent }}>
      <div className="rm-hd">
        <span className="rm-glyph">
          <Icon name={meta.icon} size={13} />
        </span>
        <span className="rm-nm">
          <span className="rm-name">{op.type}</span>
        </span>
      </div>
      <div className="rm-params">
        {entries.map(([k, v]) => (
          <div className="rm-p" key={k}>
            <span className="rm-k">{k}</span>
            <span className="rm-v">{formatParam(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface FixBoardProps {
  verdicts: VerdictDto[];
  moves: Move[];
  committedIds: ReadonlySet<string>;
  onToggleCommit: (move: Move) => void;
}

export function FixBoard({ verdicts, moves, committedIds, onToggleCommit }: FixBoardProps) {
  const findings = useMemo(
    () => verdicts.filter((v) => v.headline !== 'Specialist failed'),
    [verdicts],
  );
  const moveFor = useMemo(() => {
    const byId = new Map(moves.filter((m) => m.verdictId).map((m) => [m.verdictId as string, m]));
    return (v: VerdictDto): Move | null => (v.fixable ? (byId.get(v.id) ?? null) : null);
  }, [moves]);

  const [fixableOnly, setFixableOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const sorted = useMemo(
    () =>
      [...findings].sort(
        (a, b) =>
          (SEVERITY_RANK[b.severity as Sev] ?? 0) - (SEVERITY_RANK[a.severity as Sev] ?? 0) ||
          b.priorityScore - a.priorityScore,
      ),
    [findings],
  );
  const list = useMemo(
    () => (fixableOnly ? sorted.filter((f) => f.fixable) : sorted),
    [sorted, fixableOnly],
  );

  const [selId, setSelId] = useState<string | null>(null);
  useEffect(() => {
    if (list.length === 0) {
      setSelId(null);
      return;
    }
    if (!list.some((f) => f.id === selId)) setSelId(list[0]?.id ?? null);
  }, [list, selId]);

  const fixableCount = findings.filter((f) => f.fixable).length;
  const sel = findings.find((f) => f.id === selId) ?? null;

  if (findings.length === 0) {
    return (
      <div className="fb-empty">
        <div className="es-ic">
          <Icon name="check" size={20} />
        </div>
        <div className="es-t">No issues found</div>
        <div className="es-s">
          Nothing surfaced on this track. Ask the Coach if you want a second opinion.
        </div>
      </div>
    );
  }

  const allSelected =
    fixableCount > 0 &&
    findings.every((f) => {
      const m = moveFor(f);
      return !m || committedIds.has(m.id);
    });

  const onSelectAll = () => {
    const target = !allSelected;
    for (const f of findings) {
      const m = moveFor(f);
      if (!m) continue;
      const isOn = committedIds.has(m.id);
      if (target && !isOn) onToggleCommit(m);
      if (!target && isOn) onToggleCommit(m);
    }
  };

  return (
    <div className="fixboard">
      <div className="fb-list">
        <div className="fb-lh">
          <span className="t">Findings</span>
          <div className="fb-filters">
            <button type="button" className="fpill selall" onClick={onSelectAll}>
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
            <div className="fb-filterdd">
              <button
                type="button"
                className={`fpill fdd-btn${fixableOnly ? ' on' : ''}`}
                onClick={() => setFilterOpen((o) => !o)}
              >
                <Icon name="filter" size={11} />
                Filter
                {fixableOnly && <span className="fn">1</span>}
                <span className="fdd-chev">▾</span>
              </button>
              {filterOpen && (
                <>
                  <div className="fdd-scrim" onClick={() => setFilterOpen(false)} />
                  <div className="fdd-menu">
                    <label className="fdd-opt">
                      <input
                        type="checkbox"
                        checked={!fixableOnly}
                        onChange={() => setFixableOnly(false)}
                      />
                      All findings <span className="fdd-c">{findings.length}</span>
                    </label>
                    <label className="fdd-opt">
                      <input
                        type="checkbox"
                        checked={fixableOnly}
                        onChange={() => setFixableOnly(true)}
                      />
                      Fixable only <span className="fdd-c">{fixableCount}</span>
                    </label>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="fb-scroll">
          {list.length === 0 ? (
            <div className="na" style={{ margin: '8px 4px' }}>
              <Icon name="info" size={13} />
              Nothing matches this filter.
            </div>
          ) : (
            SEV_ORDER.map((sev) => {
              const grp = list.filter((f) => f.severity === sev);
              if (grp.length === 0) return null;
              return (
                <div key={sev}>
                  <div className="fb-sevhd" style={{ ['--sev' as string]: severityColor(sev) }}>
                    <span className="d" />
                    {sev === 'win' ? 'wins' : sev}
                    <span className="c">{grp.length}</span>
                  </div>
                  {grp.map((f) => {
                    const m = moveFor(f);
                    const added = m != null && committedIds.has(m.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`fb-row${f.id === selId ? ' on' : ''}${added ? ' added' : ''}`}
                        style={{ ['--sev' as string]: severityColor(f.severity) }}
                        onClick={() => setSelId(f.id)}
                      >
                        <span className="fr-dot" />
                        <span className="fr-b">
                          <span className="fr-head">{f.headline}</span>
                          <span className="fr-meta mono">
                            {groupForVerdict(f)}
                            {m && m.hasParams ? ` · ${m.scope}` : ''}
                            {!m ? ' · observation' : ''}
                          </span>
                        </span>
                        {m ? (
                          <span
                            className={`fr-add${added ? ' on' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleCommit(m);
                            }}
                            title={added ? 'Remove from Listen queue' : 'Queue this fix'}
                          >
                            <Icon name={added ? 'check' : 'plus'} size={12} />
                          </span>
                        ) : (
                          <span className="fr-obs" title="Observation — no one-click fix" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      <FixDetail
        f={sel}
        move={sel ? moveFor(sel) : null}
        added={sel != null && moveFor(sel) != null && committedIds.has(moveFor(sel)!.id)}
        onToggle={onToggleCommit}
      />
    </div>
  );
}

function FixDetail({
  f,
  move,
  added,
  onToggle,
}: {
  f: VerdictDto | null;
  move: Move | null;
  added: boolean;
  onToggle: (move: Move) => void;
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  useEffect(() => {
    setWhyOpen(false);
    setDataOpen(false);
  }, [f?.id]);

  if (!f) {
    return (
      <div className="fb-detail empty">
        <Icon name="info" size={18} />
        <span>Select a finding to see the detail and its fix.</span>
      </div>
    );
  }

  const isAi = f.source === 'llm_identifier';
  const group = groupForVerdict(f);
  const spec = specName(f);

  return (
    <div className="fb-detail" style={{ ['--sev' as string]: severityColor(f.severity) }}>
      <div className="fbd-scroll">
        <div className="fbd-toplab">Finding</div>
        <div className="fbd-meta">
          <span className="fbd-sev">{sevTitle(f.severity)}</span>
          <span className="fbd-group">{group}</span>
          {spec && spec !== group && (
            <span className="fbd-src">
              {isAi ? <span className="src ai">AI</span> : <span className="src measured">Measured</span>}
              <span>{spec}</span>
            </span>
          )}
        </div>

        <h3 className="fbd-head">
          {f.headline}
          {f.metricLine && <span className="fbd-metric">{f.metricLine}</span>}
        </h3>
        <div className="fbd-cols">
          <p className="fbd-sum">
            {f.summary}
            {f.whyItMatters && !whyOpen && (
              <button type="button" className="why-link" onClick={() => setWhyOpen(true)}>
                Why it matters
              </button>
            )}
          </p>
        </div>
        {f.whyItMatters && whyOpen && (
          <div className="fbd-why">
            <button type="button" className="q why-link-open" onClick={() => setWhyOpen(false)}>
              Why it matters ▾
            </button>
            <p>{f.whyItMatters}</p>
          </div>
        )}

        {move ? (
          <div className="fbd-fix">
            <div className="fbd-fixhd">
              <span className="fx-lab">The fix</span>
              <span className="fbd-spacer" />
            </div>
            <div className="fbd-fixsub">
              <span className="fx-scope mono">{move.hasParams ? move.scope : 'directional'}</span>
              <span className="fx-conf">
                <span className="cv">{Math.round(move.confidence * 100)}%</span> conf
              </span>
            </div>
            <div className="fbd-fixtitle">{move.title}</div>
            <div className={`directive${move.hasParams ? '' : ' directional'}`}>
              <span className="arrow">→</span>
              <div className="d-text">{move.directive}</div>
            </div>

            <div className="fbd-grid">
              {move.ops.length > 0 && (
                <div className="fbd-rack">
                  <div className="fbd-rackhd-row">
                    <span className="fbd-rackhd">Suggested fix</span>
                    <span className="fbd-footnote">
                      {added ? (
                        <>
                          <span className="dot on" />
                          Queued for Listen
                        </>
                      ) : (
                        'Add to apply live on the Listen page'
                      )}
                    </span>
                    <button
                      type="button"
                      className={`rack-toggle sm${added ? ' on' : ''}`}
                      onClick={() => onToggle(move)}
                    >
                      <Icon name={added ? 'check' : 'plus'} size={12} />
                      {added ? 'Added' : 'Add to fix rack'}
                    </button>
                  </div>
                  <div className="preset-mods">
                    {move.ops.map((op, i) => (
                      <RackModule key={i} op={op} />
                    ))}
                  </div>
                </div>
              )}
            </div>
            {move.evidence.metric && (
              <div className={`fbd-data${dataOpen ? ' open' : ''}`}>
                <button
                  type="button"
                  className="fbd-datahd"
                  onClick={() => setDataOpen((o) => !o)}
                >
                  <span className="lab">
                    <span className="fbd-dchev">{dataOpen ? '▾' : '▸'}</span>The data
                  </span>
                  <span className="metric">{move.evidence.metric}</span>
                </button>
                {dataOpen && (
                  <div className="fbd-datachart fade-up">
                    <p className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                      {move.evidence.metric}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="fbd-nofix">
            <Icon name={f.severity === 'win' ? 'check' : 'info'} size={14} />
            {f.severity === 'win'
              ? 'A win — nothing to change here.'
              : 'No one-click fix — this is an observation. Ask the Coach to dig in, or address it by hand.'}
          </div>
        )}
      </div>
    </div>
  );
}

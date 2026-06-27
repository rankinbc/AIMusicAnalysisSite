import { useMemo, useState } from 'react';

import type { VerdictDto } from '../../api/types';
import { SEVERITY_RANK, severityColor, severityLabel } from './helpers/severity';
import {
  SPECIALIST_CATALOG,
  groupColor,
  specialistGroup,
  type SpecialistGroup,
} from './helpers/specialists';
import { faultCount } from './problems-helpers';

const SEV_ORDER = ['critical', 'severe', 'moderate', 'minor', 'win'] as const;
type Sev = (typeof SEV_ORDER)[number];

const GROUP_ORDER: SpecialistGroup[] = [
  'Spectrum',
  'Loudness',
  'Dynamics',
  'Stereo',
  'Sections',
  'Stems',
  'Misc',
];

// Map a verdict to one of the 7 display groups: prefer the specialist's group,
// else infer from the category so rule-engine findings still slot in.
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

function titleize(s2: string): string {
  return s2
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function specName(v: VerdictDto): string {
  const known = SPECIALIST_CATALOG.find((x) => x.slug === v.specialist);
  return known ? known.label : titleize(v.category || 'Measured');
}

// Title-case a severity label (e.g. "CRITICAL" -> "Critical").
function sevTitle(sev: string): string {
  const label = severityLabel(sev);
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

interface FindingsTabProps {
  verdicts: VerdictDto[];
  /** Jump to the AI Coach tab to act on a fix. */
  onGoToActions: () => void;
}

export function FindingsTab({ verdicts, onGoToActions }: FindingsTabProps) {
  const [sevFilter, setSevFilter] = useState<'all' | Sev>('all');
  const [groupFilter, setGroupFilter] = useState<'all' | SpecialistGroup>('all');

  const findings = useMemo(
    () => verdicts.filter((v) => v.headline !== 'Specialist failed'),
    [verdicts],
  );
  const faults = faultCount(verdicts);

  const sevsPresent = SEV_ORDER.filter((sv) => findings.some((f) => f.severity === sv));
  const groupsPresent = GROUP_ORDER.filter((g) => findings.some((f) => groupForVerdict(f) === g));

  const list = useMemo(() => {
    let l = [...findings].sort(
      (a, b) =>
        (SEVERITY_RANK[b.severity as Sev] ?? 0) - (SEVERITY_RANK[a.severity as Sev] ?? 0) ||
        b.priorityScore - a.priorityScore,
    );
    if (sevFilter !== 'all') l = l.filter((f) => f.severity === sevFilter);
    if (groupFilter !== 'all') l = l.filter((f) => groupForVerdict(f) === groupFilter);
    return l;
  }, [findings, sevFilter, groupFilter]);

  if (faults === 0 && findings.length === 0) {
    return (
      <div className="empty-state">
        <div className="es-ic">✓</div>
        <div className="es-t">No issues found</div>
        <div className="es-s">
          Nothing critical surfaced on this track. What&rsquo;s left is finishing, not fixing — check
          the wins below or ask the Coach.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="find-filters">
        <button
          type="button"
          className={`fpill${sevFilter === 'all' ? ' on' : ''}`}
          onClick={() => setSevFilter('all')}
        >
          All <span className="fn">{findings.length}</span>
        </button>
        {sevsPresent.map((sv) => (
          <button
            key={sv}
            type="button"
            className={`fpill${sevFilter === sv ? ' on' : ''}`}
            onClick={() => setSevFilter(sevFilter === sv ? 'all' : sv)}
          >
            <span className="swatch" style={{ background: severityColor(sv) }} />
            {sevTitle(sv)} <span className="fn">{findings.filter((f) => f.severity === sv).length}</span>
          </button>
        ))}
        <span className="find-sep">·</span>
        <button
          type="button"
          className={`fpill${groupFilter === 'all' ? ' on' : ''}`}
          onClick={() => setGroupFilter('all')}
        >
          All groups
        </button>
        {groupsPresent.map((g) => (
          <button
            key={g}
            type="button"
            className={`fpill${groupFilter === g ? ' on' : ''}`}
            onClick={() => setGroupFilter(groupFilter === g ? 'all' : g)}
          >
            <span className="gdot" style={{ background: groupColor(g) }} />
            {g}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="na">No findings match this filter.</div>
      ) : (
        list.map((f) => <FindingCard key={f.id} v={f} onGoToActions={onGoToActions} />)
      )}
    </div>
  );
}

function FindingCard({ v, onGoToActions }: { v: VerdictDto; onGoToActions: () => void }) {
  const [why, setWhy] = useState(false);
  const group = groupForVerdict(v);
  const isAi = v.source === 'llm_identifier';

  return (
    <div
      className="finding"
      data-finding-id={v.id}
      style={{ ['--sev' as string]: severityColor(v.severity) }}
    >
      <div className="finding-main">
        <div className="finding-top">
          <span className="sev-badge">{sevTitle(v.severity)}</span>
          <span className="finding-group">{group}</span>
          <span className="finding-spec">
            {isAi ? (
              <span className="src ai">AI</span>
            ) : (
              <span className="src measured">Measured</span>
            )}
            <span>{specName(v)}</span>
          </span>
        </div>
        <div className="finding-head">{v.headline}</div>
        {v.summary && <div className="finding-sum">{v.summary}</div>}
        <div className="finding-foot">
          {v.metricLine && (
            <span className="ev-chip">
              <span className="em">{v.metricLine}</span>
            </span>
          )}
          <span className="spacer" />
          {v.whyItMatters && (
            <button
              type="button"
              className={`why-toggle${why ? ' on' : ''}`}
              onClick={() => setWhy((w) => !w)}
            >
              why it matters <span className="chev">▾</span>
            </button>
          )}
          {v.fixable && (
            <button type="button" className="fixlink" onClick={onGoToActions}>
              See fix in Actions →
            </button>
          )}
        </div>
      </div>
      {why && v.whyItMatters && (
        <div className="finding-why">
          <span className="q">?</span>
          <div className="wt">{v.whyItMatters}</div>
        </div>
      )}
    </div>
  );
}

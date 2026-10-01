import { useMemo, useState } from 'react';

import type { VerdictDto } from '../../api/types';
import { CostTag, usePaidAction } from '../billing/CostTag';
import { Icon } from './Icon';
import {
  SPECIALIST_CATALOG,
  SPECIALIST_GROUPS,
  groupColor,
  type SpecialistGroup,
} from './helpers/specialists';

type SpecStatus = 'idle' | 'running' | 'cached' | 'locked';

interface SpecialistTeamModalProps {
  /** Slugs whose verdicts already landed (status ≠ idle on the server). */
  ranSlugs: ReadonlySet<string>;
  /** Slugs optimistically running (POST sent, verdict not yet back). */
  runningSlugs: ReadonlySet<string>;
  /** Per-slug count of findings produced (from verdicts grouped by specialist). */
  foundBySlug: ReadonlyMap<string, number>;
  /** Triage-suggested slugs — surfaced as the "Suggested for this track" tile row. */
  suggestedSlugs?: ReadonlySet<string>;
  /** Landed verdicts — the "Already run" list previews their headlines. */
  verdicts?: VerdictDto[];
  hasStems: boolean;
  credits: number | null;
  onRun: (slug: string) => void;
  onClose: () => void;
  /** 'ran' = open on the "Already run" tab (the "N specialists run" chips).
   *  Default: the first tab holding a recommended specialist. */
  initialView?: 'roster' | 'ran';
}

const GROUP_DESC: Record<SpecialistGroup, string> = {
  Spectrum: 'Scans the frequency spectrum for imbalances, masking and resonances.',
  Loudness: 'Checks levels, headroom and loudness targets across platforms.',
  Dynamics: 'Looks at compression, punch and dynamic range over time.',
  Stereo: 'Analyzes stereo width, phase and mono compatibility.',
  Sections: 'Compares energy and contrast between song sections.',
  Stems: 'Digs into individual stems — requires a stems upload.',
  Misc: 'Specialized one-off checks that don’t fit the other groups.',
};

function SpecAvatar({ color, size = 40 }: { color: string; size?: number }) {
  return (
    <div
      className="spec-av"
      style={{
        width: size,
        height: size,
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
      }}
    >
      <Icon name="robot" size={size * 0.5} />
    </div>
  );
}

// The full roster as a modal (prototype `.spec-modal`): triage rationale,
// "Suggested for this track" + per-group tile grids (tiles SELECT, green ring),
// a collapsible "Already run" list, and a bottom action bar that runs the
// selected specialist (priced via CostTag).
export function SpecialistTeamModal({
  ranSlugs,
  runningSlugs,
  foundBySlug,
  suggestedSlugs,
  verdicts = [],
  hasStems,
  credits,
  onRun,
  onClose,
  initialView = 'roster',
}: SpecialistTeamModalProps) {
  // Triage-routed specialists are free; the guard picks the matching price.
  const paidNormal = usePaidAction('specialist');
  const paidRouted = usePaidAction('specialist', { routed: true });
  const statusOf = (slug: string, needsStems: boolean | undefined): SpecStatus => {
    if (needsStems && !hasStems) return 'locked';
    if (runningSlugs.has(slug)) return 'running';
    if (ranSlugs.has(slug)) return 'cached';
    return 'idle';
  };

  const suggested = useMemo(
    () =>
      SPECIALIST_CATALOG.filter(
        (m) =>
          suggestedSlugs?.has(m.slug) &&
          !ranSlugs.has(m.slug) &&
          !runningSlugs.has(m.slug) &&
          !(m.needsStems && !hasStems),
      ),
    [suggestedSlugs, ranSlugs, runningSlugs, hasStems],
  );

  const ran = SPECIALIST_CATALOG.filter((m) => ranSlugs.has(m.slug));
  const available = SPECIALIST_CATALOG.filter(
    (m) => !ranSlugs.has(m.slug) && !(m.needsStems && !hasStems),
  ).length;

  const headlinesBySlug = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const v of verdicts) {
      if (v.headline === 'Specialist failed') continue;
      const arr = map.get(v.specialist) ?? [];
      arr.push(v.headline);
      map.set(v.specialist, arr);
    }
    return map;
  }, [verdicts]);

  const [selSlug, setSelSlug] = useState<string | null>(suggested[0]?.slug ?? null);
  const [triageOpen, setTriageOpen] = useState(false);
  const selSpec = SPECIALIST_CATALOG.find((m) => m.slug === selSlug) ?? null;

  type TabKey = SpecialistGroup | 'ran';
  const groups = SPECIALIST_GROUPS.filter((g) => SPECIALIST_CATALOG.some((m) => m.group === g));
  const isRec = (slug: string) => suggested.some((x) => x.slug === slug);
  const [tab, setTab] = useState<TabKey>(() => {
    if (initialView === 'ran' && ran.length > 0) return 'ran';
    const recGroup = SPECIALIST_CATALOG.find((m) => isRec(m.slug))?.group;
    return recGroup ?? groups[0] ?? 'Spectrum';
  });
  const runningNow = SPECIALIST_CATALOG.filter((m) => runningSlugs.has(m.slug));
  // Running first, then recommended, then catalog order.
  const rank = (slug: string) => (runningSlugs.has(slug) ? 0 : isRec(slug) ? 1 : 2);
  const tabMembers = (tab === 'ran' ? ran : SPECIALIST_CATALOG.filter((m) => m.group === tab))
    .map((m, i) => ({ m, i }))
    .sort((x, y) => rank(x.m.slug) - rank(y.m.slug) || x.i - y.i)
    .map((x) => x.m);

  // One row per specialist, in the "Already run" list style: avatar · name ·
  // what it found (or its state) · status. Clicking selects it for the
  // action bar; triage-recommended rows are highlighted.
  const Row = ({ m }: { m: (typeof SPECIALIST_CATALOG)[number] }) => {
    const status = statusOf(m.slug, m.needsStems);
    const hits = headlinesBySlug.get(m.slug) ?? [];
    const found = foundBySlug.get(m.slug) ?? hits.length;
    const rec = status === 'idle' && suggested.some((x) => x.slug === m.slug);
    return (
      <button
        type="button"
        className={`spec-ranrow pick${m.slug === selSlug ? ' sel' : ''}${rec ? ' rec' : ''}`}
        data-status={status}
        aria-pressed={m.slug === selSlug}
        onClick={() => setSelSlug(m.slug)}
      >
        <SpecAvatar color={groupColor(m.group)} size={22} />
        <span className="srr-n">{m.label}</span>
        <span className="srr-res">
          {status === 'cached'
            ? hits.join(' · ') || (found > 0 ? 'See the Findings tab' : 'No findings')
            : status === 'running'
              ? 'Running…'
              : status === 'locked'
                ? 'Upload stems to enable'
                : rec
                  ? 'Recommended for this track'
                  : 'Not run yet'}
        </span>
        {status === 'running' ? (
          <span className="srr-found run">
            <span className="eqdots">
              <i />
              <i />
              <i />
              <i />
            </span>
          </span>
        ) : status === 'cached' ? (
          <span className="srr-found">
            {found} finding{found === 1 ? '' : 's'}
          </span>
        ) : status === 'locked' ? (
          <span className="srr-found">needs stems</span>
        ) : (
          <span className="srr-found cr">
            <CostTag action="specialist" routed={suggestedSlugs?.has(m.slug) === true} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="modal-scrim" onClick={onClose} role="presentation">
      <div
        className="modal spec-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Specialist Team"
      >
        <div className="modal-hd">
          <div className="mt">
            <div className="mk">AI Coach · on-demand</div>
            <div className="mn">Specialist Team</div>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="modal-body">
          {suggested.length > 0 && (
            <>
              <button type="button" className="triage" onClick={() => setTriageOpen((o) => !o)}>
                <span className="tri-ic">
                  <Icon name="sparkle" size={13} />
                </span>
                <span className="tri-l">AI triage</span>
                <span className="tri-sub">
                  why these {suggested.length} specialists were recommended
                </span>
                <span className="tri-chev">{triageOpen ? '▾' : '▸'}</span>
              </button>
              {triageOpen && (
                <div className="triage-body fade-up">
                  <p>
                    The coach ranked the full roster against this track’s measured profile and
                    surfaced the {suggested.length} most likely to find something — weighted by the
                    metrics that stood out on this mix.
                  </p>
                  <p className="tri-note">
                    Suggested specialists are included; others show their credit price. A result drops into the chat
                    and the Findings tab.
                  </p>
                </div>
              )}
            </>
          )}

          <p className="tab-intro spec-intro">
            {SPECIALIST_CATALOG.length} specialists across {SPECIALIST_GROUPS.length} groups. Run
            one to surface new findings — results drop into the chat and the Findings tab.
          </p>

          {runningNow.length > 0 && (
            <div className="spec-running">
              <div className="sg-h">
                <span className="sg-dot" style={{ background: 'var(--cyan)' }} />
                <span className="sg-n">Running now</span>
                <span className="sg-c">{runningNow.length}</span>
              </div>
              <div className="spec-ranlist boxed full">
                {runningNow.map((m) => (
                  <Row key={m.slug} m={m} />
                ))}
              </div>
            </div>
          )}

          <div className="spec-tabs" role="tablist" aria-label="Specialist groups">
            {groups.map((group) => {
              const members = SPECIALIST_CATALOG.filter((m) => m.group === group);
              const recCount = members.filter((m) => isRec(m.slug)).length;
              const runCount = members.filter((m) => runningSlugs.has(m.slug)).length;
              return (
                <button
                  key={group}
                  type="button"
                  role="tab"
                  aria-selected={tab === group}
                  className={`spec-tab${tab === group ? ' on' : ''}${recCount > 0 ? ' rec' : ''}`}
                  onClick={() => setTab(group)}
                  title={recCount > 0 ? `${recCount} recommended` : undefined}
                >
                  <span className="sg-dot" style={{ background: groupColor(group) }} />
                  {group}
                  <span className="st-c">{members.length}</span>
                  {runCount > 0 && <span className="st-run" aria-label="running" />}
                  {recCount > 0 && runCount === 0 && <span className="st-rec" aria-label="recommended" />}
                </button>
              );
            })}
            {ran.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'ran'}
                className={`spec-tab ranned${tab === 'ran' ? ' on' : ''}`}
                onClick={() => setTab('ran')}
              >
                Already run
                <span className="st-c">{ran.length}</span>
              </button>
            )}
          </div>

          <div className="spec-ranlist boxed full" role="tabpanel">
            {tabMembers.map((m) => (
              <Row key={m.slug} m={m} />
            ))}
          </div>
        </div>

        <div className="spec-selbar">
          {selSpec ? (
            (() => {
              const status = statusOf(selSpec.slug, selSpec.needsStems);
              const found = foundBySlug.get(selSpec.slug) ?? 0;
              return (
                <>
                  <SpecAvatar color={groupColor(selSpec.group)} size={34} />
                  <div className="ssb-b">
                    <div className="ssb-n">
                      {selSpec.label} <span className="ssb-g">{selSpec.group}</span>
                    </div>
                    <div className="ssb-d">
                      {GROUP_DESC[selSpec.group]}
                      {status === 'cached'
                        ? ` · already run${found > 0 ? ` — ${found} finding${found === 1 ? '' : 's'}` : ''}.`
                        : status === 'locked'
                          ? ' · locked — upload stems to enable.'
                          : ''}
                    </div>
                  </div>
                  {status === 'running' ? (
                    <span className="ssb-run running">
                      <span className="eqdots">
                        <i />
                        <i />
                        <i />
                      </span>
                      Running…
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="ssb-run"
                      disabled={status !== 'idle'}
                      onClick={() =>
                        (suggestedSlugs?.has(selSpec.slug) ? paidRouted : paidNormal).guard(() =>
                          onRun(selSpec.slug),
                        )
                      }
                    >
                      <Icon name="bolt" size={13} />
                      {status === 'cached' ? 'Cached' : status === 'locked' ? 'Needs stems' : (
                        <>
                          Run <CostTag action="specialist" routed={suggestedSlugs?.has(selSpec.slug) === true} />
                        </>
                      )}
                    </button>
                  )}
                </>
              );
            })()
          ) : (
            <span className="ssb-d">Select a specialist to see its details.</span>
          )}
        </div>

        <div className="spec-foot">
          <span className="sf-note">
            <span className="v">{ran.length}</span> ran · <span className="v">{available}</span>{' '}
            available
            {!hasStems && <span> · stem specialists locked</span>}
          </span>
          {credits != null && (
            <span className="sf-note">
              <span className="v">{credits}</span> credits
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

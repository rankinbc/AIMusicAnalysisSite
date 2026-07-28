import { useMemo, useState } from 'react';

import type { VerdictDto } from '../../api/types';
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
// selected specialist for 1 credit.
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
}: SpecialistTeamModalProps) {
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
  const [ranOpen, setRanOpen] = useState(false);

  const selSpec = SPECIALIST_CATALOG.find((m) => m.slug === selSlug) ?? null;

  const Tile = ({ m }: { m: (typeof SPECIALIST_CATALOG)[number] }) => {
    const status = statusOf(m.slug, m.needsStems);
    const found = foundBySlug.get(m.slug) ?? 0;
    const color = groupColor(m.group);
    return (
      <button
        type="button"
        className={`spec-tile${m.slug === selSlug ? ' sel' : ''}`}
        data-status={status}
        onClick={() => setSelSlug(m.slug)}
      >
        {found > 0 && <span className="spec-found">{found}</span>}
        <SpecAvatar color={color} />
        <span className="spec-tn">{m.label}</span>
        {status === 'running' ? (
          <span className="spec-st run">
            <span className="eqdots">
              <i />
              <i />
              <i />
              <i />
            </span>
          </span>
        ) : status === 'cached' ? (
          <span className="spec-st">{found > 0 ? `${found} found` : 'cached'}</span>
        ) : status === 'locked' ? (
          <span className="spec-st">needs stems</span>
        ) : (
          <span className="spec-st" style={{ color: 'var(--accent)' }}>
            1 cr
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
                  why these {suggested.length} specialists were suggested
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
                    Running a suggested specialist costs 1 credit and drops its result into the chat
                    and the Findings tab.
                  </p>
                </div>
              )}
            </>
          )}

          <p className="tab-intro" style={{ margin: '14px 0 16px' }}>
            {SPECIALIST_CATALOG.length} specialists across {SPECIALIST_GROUPS.length} groups.
            Already-run ones are cached; run another to surface new findings — results drop into the
            chat and the Findings tab.
          </p>

          <div className="spec-groups">
            {suggested.length > 0 && (
              <div className="spec-group">
                <div className="sg-h">
                  <span className="sg-dot" style={{ background: 'var(--accent)' }} />
                  <span className="sg-n">Suggested for this track</span>
                  <span className="sg-c">{suggested.length}</span>
                </div>
                <div className="spec-grid">
                  {suggested.map((m) => (
                    <Tile key={m.slug} m={m} />
                  ))}
                </div>
              </div>
            )}

            {SPECIALIST_GROUPS.map((group) => {
              const members = SPECIALIST_CATALOG.filter((m) => m.group === group);
              if (members.length === 0) return null;
              return (
                <div className="spec-group" key={group}>
                  <div className="sg-h">
                    <span className="sg-dot" style={{ background: groupColor(group) }} />
                    <span className="sg-n">{group}</span>
                    <span className="sg-c">{members.length}</span>
                  </div>
                  <div className="spec-grid">
                    {members.map((m) => (
                      <Tile key={m.slug} m={m} />
                    ))}
                  </div>
                </div>
              );
            })}

            {ran.length > 0 && (
              <div className="spec-group">
                <button type="button" className="sg-h sg-toggle" onClick={() => setRanOpen((o) => !o)}>
                  <span className="sg-dot" style={{ background: 'var(--text-2)' }} />
                  <span className="sg-n">Already run</span>
                  <span className="sg-c">{ran.length}</span>
                  <span className="sg-chev">{ranOpen ? '▾' : '▸'}</span>
                </button>
                {ranOpen && (
                  <div className="spec-ranlist boxed">
                    {ran.map((m) => {
                      const hits = headlinesBySlug.get(m.slug) ?? [];
                      return (
                        <div className="spec-ranrow" key={m.slug}>
                          <SpecAvatar color={groupColor(m.group)} size={22} />
                          <span className="srr-n">{m.label}</span>
                          <span className="srr-res">{hits.join(' · ')}</span>
                          <span className="srr-found">
                            {hits.length} finding{hits.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
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
                      onClick={() => onRun(selSpec.slug)}
                    >
                      <Icon name="bolt" size={13} />
                      {status === 'cached' ? 'Cached' : status === 'locked' ? 'Needs stems' : 'Run · 1 cr'}
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

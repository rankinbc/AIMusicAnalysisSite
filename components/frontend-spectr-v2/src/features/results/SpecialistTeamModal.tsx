import { useEffect, useMemo, useRef, useState } from 'react';

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
  /** 'ran' = open with "Already run" expanded and scrolled into view (the
   *  Findings header's "N specialists run" chip). Default: the roster top. */
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
  initialView = 'roster',
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
  const [ranOpen, setRanOpen] = useState(initialView === 'ran');
  const bodyRef = useRef<HTMLDivElement>(null);
  // Mount-only: land on the "Already run" list at the bottom of the body.
  useEffect(() => {
    if (initialView !== 'ran' || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [initialView]);

  const selSpec = SPECIALIST_CATALOG.find((m) => m.slug === selSlug) ?? null;

  const [openGroups, setOpenGroups] = useState<ReadonlySet<SpecialistGroup>>(new Set());
  const toggleGroup = (g: SpecialistGroup) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

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
          <span className="srr-found cr">1 cr</span>
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

        <div className="modal-body" ref={bodyRef}>
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
                    Running a suggested specialist costs 1 credit and drops its result into the chat
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

          <div className="spec-groups">
            {SPECIALIST_GROUPS.map((group) => {
              const members = SPECIALIST_CATALOG.filter((m) => m.group === group);
              if (members.length === 0) return null;
              const open = openGroups.has(group);
              const recCount = members.filter((m) => suggested.some((x) => x.slug === m.slug)).length;
              return (
                <div className="spec-group" key={group}>
                  <button
                    type="button"
                    className="sg-h sg-toggle"
                    aria-expanded={open}
                    onClick={() => toggleGroup(group)}
                  >
                    <span className="sg-dot" style={{ background: groupColor(group) }} />
                    <span className="sg-n">{group}</span>
                    <span className="sg-c">{members.length}</span>
                    {recCount > 0 && <span className="sg-rec">{recCount} recommended</span>}
                    <span className="sg-chev">{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div className="spec-ranlist boxed full">
                      {members.map((m) => (
                        <Row key={m.slug} m={m} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {ran.length > 0 && (
              <div className="spec-group">
                <button
                  type="button"
                  className="sg-h sg-toggle"
                  aria-expanded={ranOpen}
                  onClick={() => setRanOpen((o) => !o)}
                >
                  <span className="sg-dot" style={{ background: 'var(--text-2)' }} />
                  <span className="sg-n">Already run</span>
                  <span className="sg-c">{ran.length}</span>
                  <span className="sg-chev">{ranOpen ? '▾' : '▸'}</span>
                </button>
                {ranOpen && (
                  <div className="spec-ranlist boxed">
                    {ran.map((m) => (
                      <Row key={m.slug} m={m} />
                    ))}
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

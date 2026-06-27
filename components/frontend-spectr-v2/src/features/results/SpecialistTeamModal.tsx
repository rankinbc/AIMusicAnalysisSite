import {
  SPECIALIST_CATALOG,
  SPECIALIST_GROUPS,
  groupColor,
  type SpecialistGroup,
} from './helpers/specialists';
import s from './SpecialistTeamModal.module.css';

type SpecStatus = 'idle' | 'running' | 'cached' | 'locked';

interface SpecialistTeamModalProps {
  /** Slugs whose verdicts already landed (status ≠ idle on the server). */
  ranSlugs: ReadonlySet<string>;
  /** Slugs optimistically running (POST sent, verdict not yet back). */
  runningSlugs: ReadonlySet<string>;
  /** Per-slug count of findings produced (from verdicts grouped by specialist). */
  foundBySlug: ReadonlyMap<string, number>;
  hasStems: boolean;
  credits: number | null;
  onRun: (slug: string) => void;
  onClose: () => void;
}

// The full roster as a modal grid, grouped by the 7 specialist groups. Mirrors
// the prototype's Specialist Team: cached specialists show their found-count,
// stem-only ones lock without stems, and an idle tile runs on click (1 credit).
export function SpecialistTeamModal({
  ranSlugs,
  runningSlugs,
  foundBySlug,
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

  const ran = SPECIALIST_CATALOG.filter((m) => ranSlugs.has(m.slug)).length;
  const available = SPECIALIST_CATALOG.filter(
    (m) => !ranSlugs.has(m.slug) && !(m.needsStems && !hasStems),
  ).length;

  return (
    <div className={s.scrim} onClick={onClose} role="presentation">
      <div
        className={s.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Specialist Team"
      >
        <header className={s.head}>
          <div className={s.heading}>
            <span className={`mono ${s.kicker}`}>AI Coach · on-demand</span>
            <span className={s.title}>Specialist Team</span>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className={s.body}>
          <p className={s.intro}>
            {SPECIALIST_CATALOG.length} specialists across {SPECIALIST_GROUPS.length} groups.
            Already-run ones are cached; run another to surface new findings — results drop into the
            chat and the Findings tab.
          </p>

          <div className={s.groups}>
            {SPECIALIST_GROUPS.map((group: SpecialistGroup) => {
              const members = SPECIALIST_CATALOG.filter((m) => m.group === group);
              if (members.length === 0) return null;
              const color = groupColor(group);
              return (
                <section className={s.group} key={group}>
                  <div className={s.groupHead}>
                    <span className={s.groupDot} style={{ background: color }} />
                    <span className={s.groupName}>{group}</span>
                    <span className={`mono ${s.groupCount}`}>{members.length}</span>
                  </div>
                  <div className={s.grid}>
                    {members.map((m) => {
                      const status = statusOf(m.slug, m.needsStems);
                      const found = foundBySlug.get(m.slug) ?? 0;
                      return (
                        <button
                          key={m.slug}
                          type="button"
                          className={s.tile}
                          data-status={status}
                          style={{ ['--spec' as string]: color }}
                          disabled={status !== 'idle'}
                          onClick={() => status === 'idle' && onRun(m.slug)}
                        >
                          {status === 'cached' && found > 0 && (
                            <span className={`mono ${s.found}`}>{found}</span>
                          )}
                          <span className={s.tileLabel}>{m.label}</span>
                          <span className={`mono ${s.tileStatus}`}>
                            {status === 'running'
                              ? 'running…'
                              : status === 'cached'
                                ? found > 0
                                  ? `${found} found`
                                  : 'cached'
                                : status === 'locked'
                                  ? 'needs stems'
                                  : 'run · 1 cr'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <footer className={s.foot}>
          <span className={`mono ${s.footNote}`}>
            <span className={s.footV}>{ran}</span> ran · <span className={s.footV}>{available}</span>{' '}
            available{!hasStems && ' · stem specialists locked'}
          </span>
          {credits != null && (
            <span className={`mono ${s.footNote}`}>
              <span className={s.footV}>{credits}</span> credits
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

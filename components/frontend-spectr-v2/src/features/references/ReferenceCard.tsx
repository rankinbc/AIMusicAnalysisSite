import { useRef, useState, type MouseEvent } from 'react';

import { CoverArt } from '../../ui/CoverArt';
import { hueFromId } from '../../ui/hueFromId';
import { Pill } from '../../ui/Pill';
import { formatRelative } from '../../ui/relativeTime';
import { hueVar } from './hue';
import r from './references.module.css';
import type { ReferenceDto, ReferenceSetDto } from '../../api/types';

function fmtDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  reference: ReferenceDto;
  sets: ReferenceSetDto[];
  onEdit: () => void;
  onDelete: () => void;
  onToggleSet: (setId: string, isMember: boolean) => void;
}

export function ReferenceCard({ reference: ref, sets, onEdit, onDelete, onToggleSet }: Props) {
  const hue = hueFromId(ref.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const stop = (e: MouseEvent) => e.stopPropagation();

  const memberSetIds = new Set(ref.setIds);
  const memberSets = sets.filter((st) => memberSetIds.has(st.id));

  const duration = fmtDuration(ref.durationSeconds);
  const metrics: { label: string; value: string }[] = [];
  if (ref.bpm != null) metrics.push({ label: 'BPM', value: String(Math.round(ref.bpm)) });
  if (ref.detectedKey) metrics.push({ label: 'KEY', value: ref.detectedKey });
  if (ref.lufs != null) metrics.push({ label: 'LUFS', value: ref.lufs.toFixed(1) });
  if (ref.truePeakDb != null) metrics.push({ label: 'TP', value: `${ref.truePeakDb.toFixed(1)}` });
  if (duration) metrics.push({ label: '', value: duration });

  return (
    <div className={r.card}>
      <div className={r.cover}>
        <CoverArt hue={hue} size="fluid" ratio={2.4} />
        <div className={r.coverOverlay}>
          <div className={r.coverTop}>
            <Pill tone="violet">{ref.source === 'file' ? 'upload' : ref.source}</Pill>
            {ref.analyzed ? (
              <Pill tone="green">analyzed</Pill>
            ) : (
              <Pill tone="yellow">pending</Pill>
            )}
          </div>
        </div>
      </div>

      <div className={r.body}>
        <div className={r.titleRow}>
          <h3 className={r.refName} title={ref.title}>
            {ref.title}
          </h3>
          <div className={r.titleActions}>
            <div className={r.menuWrap} ref={menuRef}>
              <button
                type="button"
                className={r.menuTrigger}
                onClick={(e) => { stop(e); setMenuOpen((v) => !v); }}
                aria-label="Reference actions"
              >
                ⋮
              </button>
              {menuOpen && (
                <div className={r.menuDropdown} onMouseLeave={() => setMenuOpen(false)}>
                  <button
                    type="button"
                    className={r.menuItem}
                    onClick={(e) => { stop(e); setMenuOpen(false); onEdit(); }}
                  >
                    Edit
                  </button>
                  {sets.length > 0 && (
                    <>
                      <div className={r.menuDivider} />
                      <div className={r.menuSectionLabel}>Collections</div>
                      {sets.map((st) => {
                        const isMember = memberSetIds.has(st.id);
                        return (
                          <button
                            key={st.id}
                            type="button"
                            className={r.menuItem}
                            onClick={(e) => { stop(e); onToggleSet(st.id, isMember); }}
                          >
                            <span className={r.menuSetDot} style={hueVar(st.hue)} />
                            <span>{st.name}</span>
                            {isMember && <span className={r.menuCheck}>✓</span>}
                          </button>
                        );
                      })}
                    </>
                  )}
                  <div className={r.menuDivider} />
                  <button
                    type="button"
                    className={`${r.menuItem} ${r.menuItemDanger}`}
                    onClick={(e) => { stop(e); setMenuOpen(false); onDelete(); }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {ref.artist && <span className={r.refArtist}>{ref.artist}</span>}

        {ref.analyzed && metrics.length > 0 ? (
          <div className={r.metrics}>
            {metrics.map((m, i) => (
              <span key={i} className={r.metric}>
                {m.label && <span className={r.metricLabel}>{m.label}</span>}
                <span>{m.value}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className={r.pending}>
            {ref.analyzed ? ref.genre ?? '—' : 'analyzing in background…'}
          </span>
        )}

        {memberSets.length > 0 && (
          <div className={r.memberChips}>
            {memberSets.map((st) => (
              <span key={st.id} className={r.memberChip}>
                <span className={r.memberChipDot} style={hueVar(st.hue)} />
                {st.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={r.footer}>
        <span>added {formatRelative(new Date(ref.createdAt))}</span>
        <span>{ref.usedCount} {ref.usedCount === 1 ? 'use' : 'uses'}</span>
      </div>
    </div>
  );
}

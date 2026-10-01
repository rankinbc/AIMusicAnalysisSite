// The Analysis Complete modal's narrating coach: a running log of lines
// (built by the pure helpers/coachNarration.ts) plus one "why" chip per
// routed specialist whose tooltip carries Triage's full reason for picking it.
// Newest line is emphasised, older ones dim, and only the last few are shown
// until the user expands the earlier ones.

import { useEffect, useRef, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

import { Coach } from '../../ui/Coach';
import { RowGlyph } from './AnalysisCompleteStage';
import { GROUP_COLORS } from './helpers/analysisModalData';
import type { CoachLine, LinePart } from './helpers/coachNarration';
import type { SpecialistStage, StageRow } from './helpers/specialist-stage';
import s from './AnalysisCompleteModal.module.css';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

/** Lines visible before "N earlier" collapses the rest. */
export const VISIBLE_LINES = 5;

function Part({ p }: { p: LinePart }) {
  if (typeof p === 'string') return <>{p}</>;
  if ('b' in p) return <b>{p.b}</b>;
  return <i>{p.i}</i>;
}

function WhyChip({ row }: { row: StageRow }) {
  const [open, setOpen] = useState(false);
  const g = GROUP_COLORS[row.group];
  const chip = (
    <button
      type="button"
      className={cx(s.specChip, s[`chip_${row.state}`])}
      style={{ color: g.c, borderColor: g.d, background: g.d }}
      data-state={row.state}
      aria-label={`${row.label}: why I picked this specialist`}
      // Tap toggles (touch has no hover). Default-prevented so Radix's own
      // pointerdown/click "close" handlers don't immediately undo the toggle.
      onPointerDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        setOpen((o) => !o);
      }}
    >
      <span className={cx(s.chipGlyph, s[row.state])} aria-hidden>
        <RowGlyph state={row.state} />
      </span>
      {row.label}
    </button>
  );
  if (!row.focus) return chip;
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen} delayDuration={150}>
      <Tooltip.Trigger asChild>{chip}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={s.whyTip} side="bottom" align="start" sideOffset={6} collisionPadding={12}>
          <span className={s.whyTipHd}>Why {row.label}</span>
          {row.focus}
          <Tooltip.Arrow className={s.whyTipArrow} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function CoachNarrator({
  name,
  lines,
  stage,
}: {
  name: string;
  lines: CoachLine[];
  stage: SpecialistStage;
}) {
  const [expanded, setExpanded] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  const hidden = expanded ? 0 : Math.max(0, lines.length - VISIBLE_LINES);
  const shown = lines.slice(hidden);
  const newest = lines[lines.length - 1]?.id;

  // Keep the newest line in view when the expanded log scrolls.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newest, expanded]);

  return (
    <div className={s.coachHero} data-testid="acm-coach">
      <span className={s.chAv}>
        <Coach size={46} thinking={!stage.complete} />
      </span>
      <div className={s.chTx}>
        <div className={s.chName}>
          <span>{name}</span>
          <span className={s.chRole}>your AI coach</span>
          {hidden > 0 && (
            <button type="button" className={s.logMore} onClick={() => setExpanded(true)}>
              {hidden} earlier
            </button>
          )}
          {expanded && lines.length > VISIBLE_LINES && (
            <button type="button" className={s.logMore} onClick={() => setExpanded(false)}>
              show latest
            </button>
          )}
        </div>
        <ol className={s.chLog} ref={logRef} aria-live="polite" data-testid="acm-coach-log">
          {shown.map((l) => (
            <li
              key={l.id}
              className={cx(s.chLine, s[`tone_${l.tone}`], l.id === newest && s.newest)}
              data-line-id={l.id}
              data-testid="acm-coach-line"
            >
              {l.tone === 'pending' && <span className={s.spin} aria-hidden />}
              <span>
                {l.parts.map((p, i) => (
                  <Part key={i} p={p} />
                ))}
              </span>
            </li>
          ))}
        </ol>
        {stage.planReady && stage.total > 0 && (
          <Tooltip.Provider delayDuration={150}>
            <div className={s.chNext} data-testid="acm-coach-next">
              {stage.rows.map((r) => (
                <WhyChip key={r.slug} row={r} />
              ))}
            </div>
          </Tooltip.Provider>
        )}
      </div>
    </div>
  );
}

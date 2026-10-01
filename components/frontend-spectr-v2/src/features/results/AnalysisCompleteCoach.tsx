// The analysis page's narrating coach, as a chat. Messages come from the
// pure helpers/coachNarration.ts (+ the time-based coachWaitLines.ts) via the
// append-only useLiveNarration log. The look matches the report's coach chat
// (CoachChat / CoachThread `.cmsg` bubbles: mono role label, card-2 bubble
// with a squared tail corner, accent-bold measurements) — ported into a CSS
// module because this page is portalled out of `.rdx`, where those globals
// live. The coach speaks through his `Coach` mascot; each specialist through
// its own tinted SpecialistBot. The feed autoscrolls to the newest message.

import { useEffect, useRef, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

import { Coach } from '../../ui/Coach';
import { RowGlyph, SpecialistHead } from './AnalysisCompleteStage';
import { groupColor } from './helpers/specialists';
import type { ChatItem, ChatMessage, LinePart } from './helpers/coachNarration';
import { severityColor, severityLabel } from './helpers/severity';
import type { SpecialistStage, StageRow } from './helpers/specialist-stage';
import s from './LiveCoachChat.module.css';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

function Part({ p, onLink }: { p: LinePart; onLink?: (() => void) | undefined }) {
  if (typeof p === 'string') return <>{p}</>;
  if ('b' in p) return <b>{p.b}</b>;
  if ('i' in p) return <i>{p.i}</i>;
  // Only the closing line carries a link, and only once the report is ready.
  return (
    <button type="button" className={s.link} onClick={onLink} data-testid="acm-chat-link">
      {p.link}
    </button>
  );
}

/** A specialist's findings, listed under its report-back line: a severity
 *  mark (the report's `--sev-*` colours) + the headline. */
function FindingItems({ items, more }: { items: readonly ChatItem[]; more?: number | undefined }) {
  return (
    <ul className={s.items} data-testid="acm-chat-items">
      {items.map((it, i) => (
        <li key={i} className={s.item} data-severity={it.severity}>
          <span
            className={s.sevMark}
            style={{ '--sev': severityColor(it.severity) } as React.CSSProperties}
            title={severityLabel(it.severity)}
            aria-label={severityLabel(it.severity).toLowerCase()}
            role="img"
          />
          <span>{it.text}</span>
        </li>
      ))}
      {more !== undefined && more > 0 && (
        <li className={s.more} data-testid="acm-chat-more">
          +{more} more
        </li>
      )}
    </ul>
  );
}

function speakerKey(m: ChatMessage): string {
  return m.speaker.kind === 'coach' ? 'coach' : `spec:${m.speaker.slug}`;
}

function WhyChip({ row }: { row: StageRow }) {
  const [open, setOpen] = useState(false);
  const c = groupColor(row.group);
  const chip = (
    <button
      type="button"
      className={cx(s.chip, s[`chip_${row.state}`])}
      style={{ color: c, borderColor: `color-mix(in srgb, ${c} 34%, transparent)` }}
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
      <SpecialistHead row={row} size={18} />
      {row.label}
      <span className={s.chipGlyph} aria-hidden>
        <RowGlyph state={row.state} />
      </span>
    </button>
  );
  if (!row.focus) return chip;
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen} delayDuration={150}>
      <Tooltip.Trigger asChild>{chip}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={s.whyTip} side="top" align="start" sideOffset={6} collisionPadding={12}>
          <span className={s.whyTipHd}>Why {row.label}</span>
          {row.focus}
          <Tooltip.Arrow className={s.whyTipArrow} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function CoachChatFeed({
  name,
  messages,
  initialIds,
  stage,
  busy,
  onOpenReport,
}: {
  name: string;
  messages: readonly ChatMessage[];
  /** Already shown before this view mounted — not re-animated. */
  initialIds: ReadonlySet<string>;
  stage: SpecialistStage;
  /** Work is in flight — the coach shows a typing indicator. */
  busy: boolean;
  /** The closing line's inline "Full Report" link (same as the dock CTA). */
  onOpenReport?: (() => void) | undefined;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];
  const newest = last?.id;
  const coachSpokeLast = last?.speaker.kind === 'coach';

  // The newest message is always in view.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newest, busy]);

  return (
    <section className={s.chat} data-testid="acm-coach" aria-label="Coach">
      <div className={s.hd}>
        <Coach size={26} thinking={busy} />
        <div className={s.hdB}>
          <div className={s.hdK}>
            <span className={s.led} />
            <span className={s.lab}>{name}</span>
          </div>
          <div className={s.hdSub}>Narrating your analysis as it runs</div>
        </div>
      </div>
      <div className={s.thread} ref={threadRef} aria-live="polite" data-testid="acm-coach-log">
        {messages.map((m, i) => {
          const firstOfRun = i === 0 || speakerKey(messages[i - 1]!) !== speakerKey(m);
          const spec = m.speaker.kind === 'specialist' ? m.speaker : null;
          return (
            <div
              key={m.id}
              className={cx(
                s.msg,
                spec && s.spec,
                !firstOfRun && s.cont,
                !initialIds.has(m.id) && s.enter,
                s[`tone_${m.tone}`],
              )}
              style={spec ? ({ '--spec': groupColor(spec.group) } as React.CSSProperties) : undefined}
              data-testid="acm-chat-msg"
              data-msg-id={m.id}
              data-speaker={spec ? spec.slug : 'coach'}
            >
              <span className={s.av} aria-hidden>
                {firstOfRun && (spec ? <SpecialistHead row={spec} size={26} /> : <Coach size={26} glow={false} />)}
              </span>
              <div className={s.col}>
                {firstOfRun && <span className={s.role}>{spec ? spec.label : name}</span>}
                <div className={s.bub}>
                  {m.parts.map((p, j) => (
                    <Part key={j} p={p} onLink={onOpenReport} />
                  ))}
                  {m.items && m.items.length > 0 && <FindingItems items={m.items} more={m.more} />}
                </div>
              </div>
            </div>
          );
        })}
        {busy && (
          <div
            className={cx(s.msg, coachSpokeLast && s.cont, s.typing)}
            data-testid="acm-chat-typing"
            aria-label={`${name} is working`}
          >
            <span className={s.av} aria-hidden>
              {!coachSpokeLast && <Coach size={26} glow={false} />}
            </span>
            <div className={s.col}>
              <div className={s.bub}>
                <span className={s.dot} />
                <span className={s.dot} />
                <span className={s.dot} />
              </div>
            </div>
          </div>
        )}
      </div>
      {stage.planReady && stage.total > 0 && (
        <Tooltip.Provider delayDuration={150}>
          <div className={s.chips} data-testid="acm-coach-next">
            {stage.rows.map((r) => (
              <WhyChip key={r.slug} row={r} />
            ))}
          </div>
        </Tooltip.Provider>
      )}
    </section>
  );
}

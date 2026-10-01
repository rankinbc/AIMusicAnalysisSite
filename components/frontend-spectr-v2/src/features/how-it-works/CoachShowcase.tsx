// "Meet the Coach" on /trust/how-its-built: a static, non-interactive replica
// of the report page's coach chat panel (CoachChat / CoachChatHeader /
// CoachThread / CoachComposer), so a visitor sees the feature before they
// have a report of their own. The look is copied into a CSS module rather
// than reusing the `.rdx` globals, which only load with the results page.
//
// Thread content: the Coach's intro line, then a REAL exchange from the demo
// track's coach conversation (the answer is quoted verbatim, trimmed after
// its third sentence). The chips are the demo analysis's real measurements
// as quoted in that conversation (landing/sample/sample-data.ts: correlation
// 0.72, width 14%, width consistency 38%).
//
// Optional reveal on scroll: typing dots, then each message. Every message
// is ALWAYS in the DOM — the animation only toggles visibility — so tests,
// crawlers and reduced-motion visitors get the full conversation.
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useReducedMotion } from '../../hooks/useReducedMotion';
import { capture } from '../../lib/analytics';
import { Coach } from '../../ui/Coach';
import { CoachText } from '../results/CoachText';
import { TypingDots } from '../results/CoachResponding';
import { EvidenceChips } from '../results/EvidenceChips';
import { Icon } from '../results/Icon';
import { COACH_INTRO, DEMO_ANSWER, DEMO_EVIDENCE, DEMO_QUESTION } from './coach-showcase-content';
import s from './coach-showcase.module.css';

const MODES = ['Concise', 'Normal', 'Teach'] as const;

// Reveal timeline (ms after the panel scrolls into view). `typing` is the
// message index the dots stand in for; `shown` is how many messages are
// visible. Message 1 is the visitor's question, so it gets no dots.
const TIMELINE: { at: number; shown: number; typing: number | null }[] = [
  { at: 0, shown: 0, typing: 0 },
  { at: 1100, shown: 1, typing: null },
  { at: 2300, shown: 2, typing: null },
  { at: 2900, shown: 2, typing: 2 },
  { at: 4400, shown: 3, typing: null },
];

const ALL = 3;

/** 'static' = everything visible (SSR, tests, reduced motion, no observer). */
function useReveal(): {
  ref: RefObject<HTMLElement | null>;
  shown: number;
  typing: number | null;
} {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement | null>(null);
  const [armed] = useState(
    () => typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function' && !reduce,
  );
  const [state, setState] = useState<{ shown: number; typing: number | null }>(() =>
    armed ? { shown: 0, typing: null } : { shown: ALL, typing: null },
  );

  useEffect(() => {
    const el = ref.current;
    if (!armed || !el) return;
    const timers: number[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        for (const step of TIMELINE) {
          timers.push(window.setTimeout(() => setState({ shown: step.shown, typing: step.typing }), step.at));
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [armed]);

  // A visitor who switches reduced motion on mid-animation sees it all.
  return reduce ? { ref, shown: ALL, typing: null } : { ref, ...state };
}

export function CoachShowcase() {
  const { ref, shown, typing } = useReveal();
  const msg = (i: number) => ({ 'data-hidden': i >= shown ? 'true' : undefined });

  return (
    <section className={s.section} aria-labelledby="hiw-coach-title" data-testid="coach-showcase">
      <p className={`label ${s.eyebrow}`}>AI coach</p>
      <h2 id="hiw-coach-title">Meet the Coach</h2>
      <p>
        Once your report is ready, ask the Coach anything about your mix. It answers from your
        report&rsquo;s measurements and findings — in Concise, Normal or Teach mode — and cites the
        numbers behind its advice. It reads the analysis, not the audio itself.
      </p>

      <figure className={s.panel} ref={ref} aria-label="Example coach chat from the demo track">
        <div className={s.head}>
          <span className={s.avatar} aria-hidden="true">
            <Coach size={30} thinking={typing !== null} />
          </span>
          <div className={s.headBody}>
            <div className={s.headKey}>
              <span className={s.led} aria-hidden="true" />
              <span className={s.headLab}>Ask the Coach</span>
              <span className={s.modes}>
                {MODES.map((m) => (
                  <span key={m} className={s.mode} data-on={m === 'Normal' ? 'true' : undefined}>
                    {m}
                  </span>
                ))}
              </span>
            </div>
            <div className={s.headSub}>I know everything about this song.</div>
          </div>
          <div className={s.actions} aria-hidden="true">
            <span className={s.mixBtn}>Coach Mix</span>
            <span className={s.specBtn}>Specialists</span>
          </div>
        </div>

        <div className={s.body}>
          <div className={s.thread}>
            <div className={s.msg} data-role="bot" data-testid="coach-intro" {...msg(0)}>
              <span className={s.role}>Coach</span>
              <div className={s.bub}>
                <CoachText text={COACH_INTRO} />
              </div>
              {typing === 0 && <Typing />}
            </div>

            <div className={s.divider} {...msg(1)}>
              <span className="mono">From the demo track</span>
            </div>

            <div className={s.msg} data-role="user" {...msg(1)}>
              <span className={s.role}>You</span>
              <div className={s.bub}>{DEMO_QUESTION}</div>
            </div>

            <div className={s.msg} data-role="bot" {...msg(2)}>
              <span className={s.role}>Coach</span>
              <div className={s.bub}>
                <CoachText text={DEMO_ANSWER} />
                <EvidenceChips evidence={DEMO_EVIDENCE} className={s.chips} />
              </div>
              {typing === 2 && <Typing />}
            </div>
          </div>

          <a
            href="/demo"
            className={s.composer}
            data-testid="hiw-coach-demo-cta"
            onClick={() => capture('demo_cta_clicked', { source: 'how_it_works_coach' })}
          >
            <span className={s.fakeInput} aria-hidden="true">
              Ask the coach about this mix…
            </span>
            <span className={s.send}>
              Chat with the Coach in the demo
              <Icon name="send" size={14} />
            </span>
          </a>
          <div className={`mono ${s.cap}`}>grounded · 4 specialists ran · 4/4 suggested</div>
        </div>
      </figure>
    </section>
  );
}

/** Dots bubble overlaid on the slot of the coach message about to appear. */
function Typing() {
  return (
    <div className={s.typing} aria-hidden="true">
      <span className={s.role}>Coach</span>
      <div className={s.bub}>
        <TypingDots />
      </div>
    </div>
  );
}

// Rotating section carousel for /trust/how-its-built: a WAI-ARIA tab bar over
// a horizontally sliding stage. It auto-advances (each tab's bar fills over its
// dwell time) until the visitor picks a tab, which pins that section; the
// play/pause control resumes rotation. It never advances under
// prefers-reduced-motion, while the pointer or focus is on the stage, while
// the tab is hidden, or while the tab bar is scrolled out of view — and never
// scrolls the page. Every panel stays in the DOM (inactive ones `hidden`) so
// static renders and crawlers still see all sections.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { useReducedMotion } from '../../hooks/useReducedMotion';
import s from './section-carousel.module.css';

export interface CarouselSection {
  id: string;
  /** Short tab label. */
  label: string;
  /** Auto-advance dwell, ms. */
  dwellMs: number;
  content: ReactNode;
}

export const TICK_MS = 100;
// Matches the slide animation in section-carousel.module.css (+ slack).
const LEAVE_MS = 650;
// Room under the panels for card shadows inside the overflow-hidden stage.
const SHADOW_PAD = 40;

type Dir = 'next' | 'prev';

export function SectionCarousel({ sections, label }: { sections: readonly CarouselSection[]; label: string }) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [dir, setDir] = useState<Dir>('next');
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [docHidden, setDocHidden] = useState(false);
  const [inView, setInView] = useState(true);
  const [height, setHeight] = useState<number | null>(null);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const barRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const autoplay = playing && !reduced;
  const running = autoplay && !hover && !focusIn && !docHidden && inView;

  const go = useCallback(
    (next: number, d: Dir) => {
      if (next === active) return;
      setDir(d);
      setLeaving(reduced ? null : active);
      setActive(next);
      setElapsed(0);
    },
    [active, reduced],
  );

  // The outgoing panel only lives for its slide-out.
  useEffect(() => {
    if (leaving === null) return;
    const t = window.setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [leaving, active]);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setElapsed((e) => e + TICK_MS), TICK_MS);
    return () => window.clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (running && elapsed >= sections[active].dwellMs) go((active + 1) % sections.length, 'next');
  }, [running, elapsed, active, sections, go]);

  useEffect(() => {
    const onVis = () => setDocHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Only rotate while the tab bar (the carousel's top) is on screen.
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Keep the active tab visible inside the (phone-width) scrolling tab bar by
  // moving only the bar's own scrollLeft — never the page.
  useEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current[active];
    if (!list || !tab) return;
    const left = tab.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + tab.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = Math.max(0, left - 16);
    }
  }, [active]);

  // The stage follows the active panel's height (CSS-transitioned).
  useLayoutEffect(() => {
    const el = panelRefs.current[active];
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  const select = (i: number, focus: boolean) => {
    setPlaying(false);
    go(i, i > active ? 'next' : 'prev');
    if (focus) tabRefs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = sections.length;
    const to =
      e.key === 'ArrowRight' ? (active + 1) % n
      : e.key === 'ArrowLeft' ? (active - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    select(to, true);
  };

  const progress = Math.min(1, elapsed / sections[active].dwellMs);
  const stateLabel = reduced ? null : !playing ? 'Paused' : running ? 'Rotating' : 'Paused while you look';

  return (
    <div className={s.root} data-testid="hiw-carousel" data-playing={autoplay ? 'true' : 'false'}>
      <div className={s.bar} ref={barRef}>
        <div className={s.tabs} ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
          {sections.map((sec, i) => (
            <button
              key={sec.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`hiw-tab-${sec.id}`}
              aria-controls={`hiw-panel-${sec.id}`}
              aria-selected={i === active}
              tabIndex={i === active ? 0 : -1}
              className={s.tab}
              data-tab={sec.id}
              data-progress={i === active && autoplay ? 'true' : undefined}
              onClick={() => select(i, false)}
            >
              {sec.label}
              {i === active && autoplay ? (
                <span className={s.progress} aria-hidden="true">
                  <span className={s.fill} style={{ transform: `scaleX(${progress})` }} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {reduced ? null : (
          <div className={s.controls}>
            <span className={`mono ${s.state}`} aria-live="polite">
              {stateLabel}
            </span>
            <button
              type="button"
              className={s.play}
              data-testid="hiw-carousel-toggle"
              aria-label={playing ? 'Pause section rotation' : 'Play section rotation'}
              onClick={() => {
                setPlaying((p) => !p);
                setElapsed(0);
              }}
            >
              <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
            </button>
          </div>
        )}
      </div>

      <div
        className={s.stage}
        style={height === null ? undefined : { height: height + SHADOW_PAD }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setFocusIn(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false);
        }}
      >
        {sections.map((sec, i) => {
          const isActive = i === active;
          const isLeaving = i === leaving;
          return (
            <div
              key={sec.id}
              ref={(el) => {
                panelRefs.current[i] = el;
              }}
              role="tabpanel"
              id={`hiw-panel-${sec.id}`}
              aria-labelledby={`hiw-tab-${sec.id}`}
              hidden={!isActive && !isLeaving}
              aria-hidden={isLeaving ? true : undefined}
              inert={isLeaving ? true : undefined}
              className={s.panel}
              data-panel={sec.id}
              data-anim={reduced ? undefined : isLeaving ? `leave-${dir}` : isActive && leaving !== null ? `enter-${dir}` : undefined}
            >
              {sec.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

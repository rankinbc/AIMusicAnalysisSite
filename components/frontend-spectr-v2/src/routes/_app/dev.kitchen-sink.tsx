import { createFileRoute } from '@tanstack/react-router';

import { BrandMark, GradePill, Pill, Dot, Label } from '../../ui';
import { Coach } from '../../ui/Coach';
import { CoverArt } from '../../ui/CoverArt';
import { ProgressTimeline, type TimelineVersion } from '../../ui/ProgressTimeline';
import { SpecialistBot } from '../../ui/SpecialistBot';
import { VersionArc, type VersionArcPoint } from '../../ui/VersionArc';
import { TierChip } from '../../components/TierChip';
import { UsageMeter } from '../../components/UsageMeter';
import type { PillTone } from '../../ui/Pill';
import s from './dev.kitchen-sink.module.css';

// Story 5.10 (UX-DR46) — /dev/kitchen-sink: the component inventory used as
// the visual-regression + a11y audit surface. DEV-gated (the flag, per the
// DebugTab precedent); prod builds tree-shake the content. No Storybook.

export const Route = createFileRoute('/_app/dev/kitchen-sink')({
  component: KitchenSinkPage,
});

const PILL_TONES: PillTone[] = ['default', 'cyan', 'violet', 'orange', 'red', 'green', 'yellow'];
const GRADES = ['A', 'A-', 'B', 'C', 'D', 'F', null];
const TIMELINE: TimelineVersion[] = [
  { versionNumber: 1, label: 'rough', score: 58, grade: 'C', createdAt: '2026-06-01T00:00:00Z', isCurrent: false },
  { versionNumber: 2, label: null, score: 71, grade: 'B', createdAt: '2026-06-14T00:00:00Z', isCurrent: false },
  { versionNumber: 3, label: 'club mix', score: 84, grade: 'A-', createdAt: '2026-07-01T00:00:00Z', isCurrent: true },
];
const ARC: VersionArcPoint[] = TIMELINE.map((v) => ({
  versionNumber: v.versionNumber,
  score: v.score,
  grade: v.grade,
}));

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card">
      <div className="card-hd">
        <span className="label">{title}</span>
        <a className={s.topLink} href="#sink-toc">
          ↑ toc
        </a>
      </div>
      <div className={`card-body ${s.sectionBody}`}>{children}</div>
    </section>
  );
}

const SECTIONS = [
  ['utilities', 'Utility classes'],
  ['primitives', 'UI primitives'],
  ['meters', 'Meters, chips & banners'],
  ['focus', 'Focus order strip'],
] as const;

export function KitchenSinkPage() {
  if (!import.meta.env.DEV) {
    return (
      <div className={s.page}>
        <p className="mono">Kitchen sink is a dev-only surface.</p>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>Kitchen sink</h1>
        <p className={s.sub}>
          Component inventory — the visual-regression and a11y audit surface (UX-DR46). Dev builds
          only.
        </p>
        <nav id="sink-toc" aria-label="Sections" className={s.toc}>
          {SECTIONS.map(([id, title]) => (
            <a key={id} href={`#${id}`} className="pill">
              {title}
            </a>
          ))}
        </nav>
      </header>

      <Section id="utilities" title="Utility classes">
        <div className={s.row}>
          {PILL_TONES.map((tone) => (
            <span key={tone} className={`pill ${tone === 'default' ? '' : tone}`}>
              pill {tone}
            </span>
          ))}
        </div>
        <div className={s.row}>
          <span className="dot" /> <span className="dot violet" /> <span className="dot orange" />{' '}
          <span className="dot red" />
          <span className="label">label caption</span>
          <span className="mono">mono 01:23</span>
        </div>
        <div className={s.row}>
          <button type="button" className="btn">
            btn
          </button>
          <button type="button" className="btn primary">
            btn primary
          </button>
          <button type="button" className="btn ghost">
            btn ghost
          </button>
          <button type="button" className="btn sm">
            btn sm
          </button>
          <button type="button" className="btn violet">
            btn violet
          </button>
          <button type="button" className="btn" disabled>
            btn disabled
          </button>
        </div>
        <div className="card">
          <div className="card-hd">
            <span className="label">card-hd</span>
          </div>
          <div className="card-body">card-body content</div>
        </div>
      </Section>

      <Section id="primitives" title="UI primitives">
        <div className={s.row}>
          {GRADES.map((g) => (
            <GradePill key={g ?? 'none'} grade={g} size="sm" />
          ))}
          <GradePill grade="A" size="md" />
          <GradePill grade="B" size="lg" />
        </div>
        <div className={s.row}>
          <Pill tone="cyan">Pill component</Pill>
          <Dot tone="orange" />
          <Label>Label component</Label>
          <BrandMark size={22} glow />
          <Coach size={64} />
          <Coach size={64} thinking />
          <SpecialistBot size={44} live />
          <CoverArt hue={200} size="sm" />
          <CoverArt hue={320} size="md" />
        </div>
        <div className={s.row}>
          <VersionArc versions={ARC} delta={13} />
          <VersionArc versions={ARC} compact />
        </div>
        <ProgressTimeline versions={TIMELINE} height={180} />
      </Section>

      <Section id="meters" title="Meters, chips & banners">
        <div className={s.row}>
          <TierChip tier="free" />
          <TierChip tier="pro" />
          <TierChip tier="credits" />
        </div>
        <div className={s.meterCol}>
          <UsageMeter label="Analyses" used={2} limit={3} variant="page" />
          <UsageMeter label="Credits" used={0} limit={null} valueText="7 left" variant="nav" />
        </div>
        {/* Static banner anatomy (the live DegradationBanner needs query
            providers — this surface audits the visual grammar only). */}
        <div className={s.bannerDemo} role="status" aria-label="Partial analysis (demo)">
          <span className={s.bannerDot} aria-hidden="true" />
          <p className={s.bannerMsg}>
            <strong>Stem clash</strong> hit a snag — we kept everything that worked.
          </p>
          <button type="button" className="btn sm">
            Retry free
          </button>
        </div>
      </Section>

      <Section id="focus" title="Focus order strip">
        <p className={s.sub}>
          Tab through: every interactive must show the cyan ring (UX-DR44). Mixed element types on
          purpose.
        </p>
        <div className={s.row}>
          <button type="button" className="btn sm">
            button
          </button>
          <a className="pill cyan" href="#sink-toc">
            link
          </a>
          <input className={s.demoInput} aria-label="demo input" placeholder="input" />
          <select className={s.demoInput} aria-label="demo select">
            <option>select</option>
          </select>
          <textarea className={s.demoInput} aria-label="demo textarea" rows={1} placeholder="textarea" />
          <details className={s.demoDetails}>
            <summary>summary</summary>
            details content
          </details>
          <span tabIndex={0} className="pill" role="button">
            tabindex span
          </span>
        </div>
      </Section>
    </div>
  );
}

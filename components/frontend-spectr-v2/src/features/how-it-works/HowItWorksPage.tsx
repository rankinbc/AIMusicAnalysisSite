// /trust/how-its-built — the "how it works" page: the pipeline diagram, worked
// examples from the real demo analysis, a replica of the coach chat, the step-by-step flow from upload to
// a plan, what sets SPECTR apart from score-and-tips
// mix checkers, and the two funnel CTAs. Copy lives in
// pipeline.ts, where every entry cites the code that backs it. Lives in
// features/ so the router's auto code-splitting lazy-chunks it out of the
// entry bundle (same pattern as the other trust route files).
import { useEffect } from 'react';

import { capture } from '../../lib/analytics';
import { TrustPage } from '../trust/TrustPage';
import { CoachShowcase } from './CoachShowcase';
import { DawPlanSection } from './DawPlanSection';
import { ExampleFindings } from './ExampleFindings';
import { ListenSection } from './ListenSection';
import { DIFFERENTIATORS, KIND_LABEL, STAGES } from './pipeline';
import { PipelineDiagram } from './PipelineDiagram';
import { SectionCarousel } from './SectionCarousel';
import type { CarouselSection } from './SectionCarousel';
import s from './how-it-works.module.css';

// Steps are numbered continuously across stages; each stage's <ol> starts
// where the previous one ended.
const STAGE_OFFSETS = STAGES.map((_, i) => STAGES.slice(0, i).reduce((n, st) => n + st.steps.length, 0));

function PipelineSection() {
  return (
    <>
      <h2>The analysis pipeline</h2>
      <p>
        Your track goes through twelve measurement modules, two lanes of diagnosis —
        fixed rules and AI specialists — and a validator, before anything is shown to you.
      </p>
      <PipelineDiagram />
    </>
  );
}

function FindingsSection() {
  return (
    <>
      <h2>What it finds — and what it tells you to do</h2>
      <p>
        Four real findings from the demo analysis. Each one cites the measurements behind it, explains why
        it matters, and comes with a fix you can dial in.
      </p>
      <ExampleFindings />
    </>
  );
}

function CoachSection() {
  return (
    <>
      <CoachShowcase />
    </>
  );
}

function PlanSection() {
  return (
    <>
      <h2>From upload to a plan</h2>
      <div className={s.pipeline}>
        {STAGES.map((stage, si) => (
          <section key={stage.id} className={s.stage} aria-labelledby={`stage-${stage.id}`}>
            <h3 id={`stage-${stage.id}`} className={`label ${s.stageLabel}`}>
              {stage.label}
            </h3>
            <ol className={s.steps} start={STAGE_OFFSETS[si] + 1}>
              {stage.steps.map((step, i) => {
                const stepNo = STAGE_OFFSETS[si] + i + 1;
                return (
                  <li key={step.id} className={s.step} data-kind={step.kind} data-step={step.id}>
                    <span className={`mono ${s.stepNo}`} aria-hidden>
                      {String(stepNo).padStart(2, '0')}
                    </span>
                    <div className={s.stepBody}>
                      <div className={s.stepHead}>
                        <h4 className={s.stepTitle}>{step.title}</h4>
                        <span className={`mono ${s.kind}`}>{KIND_LABEL[step.kind]}</span>
                      </div>
                      <p className={s.stepText}>{step.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}

function DiffSection() {
  return (
    <>
      <h2>What makes it different</h2>
      <div className={s.diffGrid}>
        {DIFFERENTIATORS.map((d) => (
          <div key={d.id} className={`card ${s.diffCard}`} data-diff={d.id}>
            <h3 className={s.diffTitle}>{d.title}</h3>
            <p className={s.diffText}>{d.body}</p>
          </div>
        ))}
      </div>
    </>
  );
}

// Carousel order = the page's reading order. Dwell scales with how much
// there is to take in.
const SECTIONS: readonly CarouselSection[] = [
  { id: 'pipeline', label: 'Pipeline', dwellMs: 12_000, content: <PipelineSection /> },
  { id: 'findings', label: 'Findings', dwellMs: 16_000, content: <FindingsSection /> },
  { id: 'coach', label: 'The Coach', dwellMs: 14_000, content: <CoachSection /> },
  { id: 'steps', label: 'Upload to plan', dwellMs: 16_000, content: <PlanSection /> },
  { id: 'listen', label: 'Hear it', dwellMs: 14_000, content: <ListenSection /> },
  { id: 'different', label: 'Why it’s different', dwellMs: 12_000, content: <DiffSection /> },
  { id: 'daw', label: 'To your DAW', dwellMs: 14_000, content: <DawPlanSection /> },
];

export function HowItWorksPage() {
  // Once per mount, no-op without a PostHog key. The event name predates
  // this page's rewrite and is kept so the funnel history stays continuous.
  useEffect(() => {
    capture('engineering_viewed');
  }, []);

  return (
    <TrustPage
      path="/trust/how-its-built"
      eyebrow="How it works"
      wide
      title="How SPECTR works"
      metaDescription="From upload to a mix plan: SPECTR measures your track, flags problems with genre-relative rules and AI specialists, checks every finding against the measurements, and lets you hear the fixes in your browser."
    >
      <p className={s.lead}>
        Most online mix checkers give you a score and a list of problems &mdash; and leave the fixing
        to you. SPECTR doesn&rsquo;t stop there. It measures your track, pinpoints what&rsquo;s holding it
        back, and then works with you to fix it: a prioritised plan with exact settings, every fix
        playable on your own track before you touch your DAW, and a Coach that knows your mix.
      </p>

      <SectionCarousel label="How SPECTR works, section by section" sections={SECTIONS} />

      <div className={`card ${s.cta}`}>
        <h2 className={s.ctaTitle}>See it for yourself</h2>
        <p className={s.ctaText}>
          The demo opens a real analysis — findings, plan, coach and Listen rack — with no signup.
        </p>
        <div className={s.ctaBtns}>
          <a
            href="/demo"
            className={`btn ${s.demoBtn}`}
            data-testid="hiw-demo-cta"
            onClick={() => capture('demo_cta_clicked', { source: 'how_it_works' })}
          >
            See it on a real track →
          </a>
          <a href="/analyze" className="btn primary" data-testid="hiw-analyze-cta">
            Analyze your track free
          </a>
        </div>
      </div>
    </TrustPage>
  );
}

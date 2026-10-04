// /trust/how-its-built — the "how it works" page: ONE session with SPECTR,
// step by step, in the order a producer goes through it (workflow.ts). Each
// step says what you do and what SPECTR does, then shows that step for real:
// the analysis pipeline, worked examples from the demo analysis, a replica of
// the coach chat, the Listen page, the DAW Plan. What each part can do in
// depth is the /features page's job — this page is the sequence. Lives in
// features/ so the router's auto code-splitting lazy-chunks it out of the
// entry bundle (same pattern as the other trust route files).
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { capture } from '../../lib/analytics';
import { Coach } from '../../ui/Coach';
import { LibraryVignette } from '../features-page/vignettes/WorkflowVignettes';
import { TrustPage } from '../trust/TrustPage';
import { AbletonExportGuide } from './AbletonExportGuide';
import { CoachShowcase } from './CoachShowcase';
import { DawPlanSection } from './DawPlanSection';
import { ExampleFindings } from './ExampleFindings';
import { ListenSection } from './ListenSection';
import { KIND_LABEL, STAGES } from './pipeline';
import { PipelineDiagram } from './PipelineDiagram';
import { SectionCarousel } from './SectionCarousel';
import type { CarouselSection } from './SectionCarousel';
import { WORKFLOW } from './workflow';
import type { WorkflowStep } from './workflow';
import s from './how-it-works.module.css';

// What happens while you wait: the measure + diagnose stages. The "act"
// stage (plan, listen, coach) is the rest of this page's steps.
const ANALYSIS_STAGES = STAGES.filter((st) => st.id !== 'act');
// Steps are numbered continuously across stages; each stage's <ol> starts
// where the previous one ended.
const STAGE_OFFSETS = ANALYSIS_STAGES.map((_, i) =>
  ANALYSIS_STAGES.slice(0, i).reduce((n, st) => n + st.steps.length, 0),
);

/** The step header every panel opens with: where you are, your part, SPECTR's part. */
function StepIntro({ step }: { step: WorkflowStep }) {
  const n = WORKFLOW.indexOf(step) + 1;
  return (
    <div className={s.stepIntro} data-testid={`workflow-${step.id}`}>
      <p className={`label ${s.stepCount}`}>
        Step {n} of {WORKFLOW.length}
        <span className={s.stepNote}>{step.note}</span>
      </p>
      <dl className={s.roles}>
        <div className={s.role}>
          <dt>You</dt>
          <dd>{step.you}</dd>
        </div>
        <div className={s.role} data-who="spectr">
          <dt>
            {step.coach && (
              <span className={s.roleCoach} aria-hidden="true"><Coach size={26} glow={false} /></span>
            )}
            {step.coach ? 'The Coach' : 'SPECTR'}
          </dt>
          <dd>{step.spectr}</dd>
        </div>
      </dl>
    </div>
  );
}

function UploadSection() {
  return (
    <>
      <h2>Start with a bounce</h2>
      <p>
        The mix file is all SPECTR needs. Stems, your Ableton project and a reference track are
        optional — each one makes the analysis, and the fixes, more specific to your session.
      </p>
      <p>
        Working in Ableton Live and not sure how to export stems? The export settings make a real
        difference to what SPECTR can tell you.
      </p>
      <AbletonExportGuide />
    </>
  );
}

function AnalysisSection() {
  return (
    <>
      <h2>What happens while you wait</h2>
      <p>
        Your track goes through twelve measurement modules, two lanes of diagnosis — fixed rules
        and AI specialists — and a validator, before anything is shown to you.
      </p>
      <PipelineDiagram />
      <div className={s.pipeline}>
        {ANALYSIS_STAGES.map((stage, si) => (
          <section key={stage.id} className={s.stage} aria-labelledby={`stage-${stage.id}`}>
            <h3 id={`stage-${stage.id}`} className={`label ${s.stageLabel}`}>
              {stage.label}
            </h3>
            <ol className={s.steps} start={STAGE_OFFSETS[si]! + 1}>
              {stage.steps.map((step, i) => {
                const stepNo = STAGE_OFFSETS[si]! + i + 1;
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

function NextSection() {
  return (
    <>
      <h2>Bounce it and come back</h2>
      <p>
        One pass rarely finishes a mix. Every song keeps its versions side by side, so each round
        starts from what you changed last time rather than from scratch.
      </p>
      <figure className={`card ${s.progress}`}>
        <figcaption className={s.progressCaption}>
          <span className="label">Example</span>
          A song in your library: every version kept, any two compared
        </figcaption>
        <LibraryVignette />
      </figure>
      <ol className={s.loop} aria-label="The loop">
        {WORKFLOW.map((step) => (
          <li key={step.id}>{step.label}</li>
        ))}
      </ol>
    </>
  );
}

const CONTENT: Record<WorkflowStep['id'], ReactNode> = {
  upload: <UploadSection />,
  pipeline: <AnalysisSection />,
  findings: <FindingsSection />,
  coach: <CoachShowcase />,
  listen: <ListenSection />,
  daw: <DawPlanSection />,
  next: <NextSection />,
};

// Dwell scales with how much there is to take in.
const DWELL_MS: Record<WorkflowStep['id'], number> = {
  upload: 10_000,
  pipeline: 16_000,
  findings: 16_000,
  coach: 14_000,
  listen: 14_000,
  daw: 14_000,
  next: 10_000,
};

// Carousel order = the order of a session.
const SECTIONS: readonly CarouselSection[] = WORKFLOW.map((step, i) => ({
  id: step.id,
  label: `${i + 1} · ${step.label}`,
  dwellMs: DWELL_MS[step.id],
  content: (
    <>
      <StepIntro step={step} />
      {CONTENT[step.id]}
    </>
  ),
}));

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
      metaDescription="A session with SPECTR, step by step: upload a bounce, watch the analysis run, read the findings, ask the Coach, hear the fixes on your own track, take a plan to your DAW, then upload the next version."
    >
      <p className={s.lead}>
        Most online mix checkers give you a score and a list of problems &mdash; and leave the fixing
        to you. SPECTR is built to be worked with. This is what one session looks like, from dropping
        in a bounce to uploading the next one: what you do at each step, and what SPECTR does in return.
      </p>
      <p className={s.featuresLink}>
        Looking for what each part can do? <a href="/features">See the features →</a>
      </p>

      <SectionCarousel label="A session with SPECTR, step by step" sections={SECTIONS} />

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

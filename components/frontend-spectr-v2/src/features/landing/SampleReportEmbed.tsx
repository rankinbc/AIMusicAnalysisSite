/* Story 6.1 (UX-DR24) — the landing's live sample report: REAL report
 * components (GradeHero revived from the results feature) fed with real
 * trimmed pipeline output. Explicitly not a screenshot. */
import { GLOSSARY } from '../results/glossary-terms';
import { GradeHero } from '../results/GradeHero';
import { Pill } from '../../ui/Pill';
import { SAMPLE_REPORT } from './sample-report';
import s from './landing.module.css';

const LUFS_DEFINITION = GLOSSARY.find(([term]) => term === 'LUFS')![1];

export function SampleReportEmbed() {
  const r = SAMPLE_REPORT;
  return (
    <section className={`card ${s.embed}`} aria-label="Sample report">
      <div className={s.embedHead}>
        <span className="label">Live sample report</span>
        <span className={`mono ${s.embedNote}`}>real pipeline output · rough mix on purpose</span>
      </div>

      <div className={s.embedBody}>
        <p className={s.plainSummary}>{r.plainSummary}</p>

        <GradeHero grade={r.grade} score={r.overallScore} danceability={r.danceability} />

        <div className={s.embedMeta}>
          <Pill><span className="mono">{r.bpm}</span> BPM</Pill>
          <Pill><span className="mono">{r.detectedKey}</span></Pill>
          <Pill><span className="mono">{r.lufs.toFixed(1)}</span> LUFS</Pill>
        </div>

        <p className={s.gloss}>
          <span className="mono">LUFS</span> — {LUFS_DEFINITION}
        </p>

        <ul className={s.findings}>
          {r.findings.map((f) => (
            <li key={f.tag} className={s.finding}>
              <span className={`mono ${s.findingTag}`}>{f.tag}</span>
              <span className={s.findingText}>{f.text}</span>
              <span className={s.findingPlain}>
                <span className={`mono ${s.plainTag}`}>In plain English</span> {f.plain}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className={s.embedCaption}>
        This is a real report from a real rough mix — SPECTR doesn&rsquo;t flatter.{' '}
        <a href="/register">Get yours free →</a>{' · '}
        <a href="/demo">See a full report in the demo →</a>
      </p>
    </section>
  );
}

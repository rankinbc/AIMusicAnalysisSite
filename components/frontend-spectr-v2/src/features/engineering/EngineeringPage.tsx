// Task P4 (public-surfaces-polish) — the honest engineering page for a
// technical, non-audio visitor (spec §3.1). Every sentence here traces to a
// file cited in the inline comment beside it; decisions.ts carries the same
// discipline for the decision cards. Numbers in "By the numbers" come only
// from stats.generated.json (re-floored by scripts/site-stats.mjs and kept
// honest by __tests__/site-stats.test.ts) — never typed by hand.
import { useEffect } from 'react';

import { capture } from '../../lib/analytics';
import { SITE } from '../../config/site';
import { TrustPage } from '../trust/TrustPage';
import { BASE_PHASES } from '../results/progress-phases';
import { ArchitectureDiagram } from './ArchitectureDiagram';
import { DECISIONS } from './decisions';
import s from './engineering.module.css';
import stats from './stats.generated.json';

// Friendly labels for the keys scripts/site-stats.mjs produces (§3.3). A
// key the script doesn't know about yet falls back to itself so the page
// never silently drops a number.
const STAT_LABELS: Record<string, string> = {
  frontendTestFiles: 'frontend test files',
  frontendTestCases: 'frontend test cases',
  bffTestClasses: 'BFF test classes',
  bffTestCases: 'BFF test cases',
  pythonTestFiles: 'Python test files',
  endpoints: 'BFF endpoints',
  migrations: 'database migrations',
  tables: 'database tables',
  specialistPrompts: 'AI specialist prompts',
};

export function EngineeringPage() {
  // Story 6.5 idiom (landing_viewed / pricing_viewed) — once per mount,
  // no-op without a PostHog key.
  useEffect(() => {
    capture('engineering_viewed');
  }, []);

  return (
    <TrustPage
      path="/trust/how-its-built"
      eyebrow="Engineering"
      title="How SPECTR is built"
      metaDescription="The architecture, the decisions and the guard rails behind SPECTR — a .NET BFF, a Python analysis worker and a React audio workstation."
    >
      <h2>What it is</h2>
      {/* README.md's opening line + "What it does" bullets: upload -> graded
          report -> rule engine + specialists explain fixes -> hear them live. */}
      <p>
        Upload a track. A {BASE_PHASES.length}-phase measurement pipeline grades it. A deterministic rule
        engine and on-demand AI specialists explain what to fix. You hear every fix live, in the browser,
        before committing to it.
      </p>
      <p>
        <a href="/demo">Explore the demo</a>
      </p>
      <p className={`mono ${s.credit}`}>
        Demo track: &ldquo;Magnetic Fields&rdquo; by Artifact303, used with permission.
      </p>

      <h2>Architecture</h2>
      {/* README.md "Architecture" section, near-verbatim. */}
      <p>
        The browser talks only to the BFF. Analysis work is enqueued to Redis and consumed by a Python
        worker. Results land in PostgreSQL. There is no HTTP hop between the two services — the BFF writes
        the worker&rsquo;s queue format directly.
      </p>
      <ArchitectureDiagram />

      <h2>Decisions</h2>
      <ul className={s.decisions}>
        {DECISIONS.map((d) => (
          <li key={d.id} className={`card ${s.decisionCard}`}>
            <h3 className={s.decisionTitle}>{d.title}</h3>
            <p>{d.body}</p>
          </li>
        ))}
      </ul>

      <h2>By the numbers</h2>
      <dl className={s.stats}>
        {Object.entries(stats.floors).map(([key, value]) => (
          <div className={s.stat} key={key}>
            <dt className={s.statLabel}>{STAT_LABELS[key] ?? key}</dt>
            <dd className={`mono ${s.statValue}`}>{`${value.toLocaleString('en-US')}+`}</dd>
          </div>
        ))}
      </dl>
      <p>
        The pipeline runs {BASE_PHASES.length} phases end to end. Dispatch is tier-routed across four
        named queues, so coach replies, paid analyses, free analyses and housekeeping never share one
        undifferentiated backlog.
      </p>

      <h2>CI and security</h2>
      {/* .github/workflows/ci.yml: 5 jobs (secrets, bff, frontend, python,
          deploy); secrets job uses fetch-depth:0 + sha256sum -c; deploy job
          builds images, Trivy-scans with exit-code 1 on CRITICAL, scan runs
          BEFORE the push. infra/deploy.sh: verify_health + auto-rollback. */}
      <p>
        Five CI jobs run on every push. A secrets scan checks the full git history with a
        checksum-verified scanner. Separate jobs build and test the BFF, the frontend and the Python
        packages, with the integration suite running against real PostgreSQL and Redis, not mocks.
        Container images are scanned before they&rsquo;re pushed, and a CRITICAL finding blocks the push.
        The deploy script checks the new version&rsquo;s health after every deploy and rolls back
        automatically if it fails.
      </p>

      <h2>Known limits</h2>
      {/* README.md "Status and limitations"; infra/compose.prod.yml
          (worker-free's WORKER_QUEUES shares analysis-paid, analysis-free
          and maintenance on one pool). */}
      <ul>
        <li>Analysis lanes share one worker pool on the current single-VM deployment.</li>
        <li>Full ML stem separation is off by default; a faster spectral-analysis path runs instead.</li>
        <li>
          The Listen rack&rsquo;s pitch tool couples pitch and tempo — true tempo-independent shifting
          isn&rsquo;t built yet.
        </li>
        <li>
          Audio streaming authenticates with a short-lived token in the URL, because a browser{' '}
          <code className={s.code}>&lt;audio&gt;</code> element can&rsquo;t send a header.
        </li>
      </ul>

      <h2>Source</h2>
      <p>SPECTR is open source.</p>
      <p>
        <a href={SITE.repoUrl} rel="noopener noreferrer">
          Source on GitHub
        </a>
      </p>
      <p>
        <a href={SITE.ciUrl} rel="noopener noreferrer">
          CI runs on every push →
        </a>
      </p>
    </TrustPage>
  );
}

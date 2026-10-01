/* Landing page live sample report — the real report vocabulary (chips,
 * evidence table, op rack, glossary) fed by REAL pipeline output for
 * "Magnetic Fields" by Artifact303 (sample-data.ts, generated). Lazy-loaded
 * by LandingPage so neither this nor the results stylesheets land in the
 * entry chunk. Read-only: nothing here calls an API. */
import { useMemo, useState } from 'react';

import { deriveCoachSuggestions } from '../../results/coach-suggestion-templates';
import { Icon } from '../../results/Icon';
import '../../results/redesign-v3.css';
import '../../results/redesign-v3-tabs.css';
import { SAMPLE_FINDINGS, SAMPLE_META } from './sample-data';
import { SampleFindingRow } from './SampleFindingRow';
import { planSteps, isWin, teamOf } from './sample-model';
import { SamplePlan } from './SamplePlan';
import s from './SampleReport.module.css';

type View = 'issues' | 'plan' | 'wins';

function fmt(n: number | null, unit: string, digits = 1): string {
  if (n == null) return '—';
  const v = n.toFixed(digits).replace('-', '−');
  return unit ? `${v} ${unit}` : v;
}

export default function SampleReport() {
  const m = SAMPLE_META;
  const issues = useMemo(() => SAMPLE_FINDINGS.filter((f) => !isWin(f)), []);
  const wins = useMemo(() => SAMPLE_FINDINGS.filter(isWin), []);
  const plan = useMemo(() => planSteps(SAMPLE_FINDINGS), []);
  const team = useMemo(() => teamOf(SAMPLE_FINDINGS), []);
  const aiCount = team.filter((t) => !t.isRule).length;
  const questions = useMemo(
    () => deriveCoachSuggestions(SAMPLE_FINDINGS.map((f) => f.verdict)).slice(0, 3),
    [],
  );

  const [view, setView] = useState<View>('issues');
  const [openId, setOpenId] = useState<string | null>(issues[0]?.verdict.id ?? null);
  const [plain, setPlain] = useState(false);

  const list = view === 'wins' ? wins : issues;
  const tabs: { key: View; label: string; count: number }[] = [
    { key: 'issues', label: 'Findings', count: issues.length },
    { key: 'plan', label: 'Fix plan', count: plan.length },
    { key: 'wins', label: 'Wins', count: wins.length },
  ];

  return (
    <div className={`rdx ${s.root}`} data-testid="sample-report">
      <header className={s.head}>
        <div className={s.titleBlock}>
          <h3 className={s.track}>
            {m.title}
            {m.artist && <span className={s.artist}>— {m.artist}</span>}
          </h3>
          <div className={`mono ${s.trackMeta}`}>
            {m.genre && <span>{m.genre.replace(/_/g, ' ')}</span>}
            {m.key && <span>{m.key}</span>}
            <span>pipeline {m.pipelineVersion}</span>
          </div>
        </div>
        <div className={`mono ${s.grade}`} title="Overall score — a summary, not the point">
          <span className={s.gradeLetter}>{m.grade}</span>
          <span>{m.score}/100</span>
        </div>
      </header>

      <dl className={s.stats}>
        <div><dt>Loudness</dt><dd className="mono">{fmt(m.lufs, 'LUFS')}</dd></div>
        <div><dt>True peak</dt><dd className="mono">{fmt(m.truePeakDb, 'dBTP')}</dd></div>
        <div><dt>L/R correlation</dt><dd className="mono">{fmt(m.stereoCorrelation, '', 2)}</dd></div>
        <div><dt>Crest factor</dt><dd className="mono">{fmt(m.crestFactorDb, 'dB')}</dd></div>
      </dl>

      <section className={s.team} aria-label="Who reviewed this mix">
        <p className={s.teamLine}>
          <b>{aiCount} AI specialists</b> plus the measurement engine reviewed this mix. Every
          finding cites the numbers it rests on.
        </p>
        <ul className={s.teamChips}>
          {team.map((t) => (
            <li key={t.name} className={`mono ${s.teamChip}${t.isRule ? ` ${s.teamRule}` : ''}`}>
              <Icon name={t.isRule ? 'chart' : 'robot'} size={11} />
              {t.name}
              <span className={s.teamCount}>{t.count}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className={s.toolbar}>
        <div className={s.tabs} role="tablist" aria-label="Sample report views">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={view === t.key}
              className={`${s.tab}${view === t.key ? ` ${s.tabOn}` : ''}`}
              onClick={() => setView(t.key)}
            >
              {t.label}
              <span className={`mono ${s.tabCount}`}>{t.count}</span>
            </button>
          ))}
        </div>
        {view !== 'plan' && (
          <label className={s.plainToggle}>
            <input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} />
            <span>Plain English</span>
          </label>
        )}
      </div>

      <div role="tabpanel" className={s.panel}>
        {view === 'plan' ? (
          <>
            <p className={s.panelIntro}>
              Recommended actions, highest priority first — exact settings you can dial into any
              DAW.
            </p>
            <SamplePlan steps={plan} />
          </>
        ) : (
          <ul className={s.list}>
            {list.map((f) => (
              <SampleFindingRow
                key={f.verdict.id}
                finding={f}
                open={openId === f.verdict.id}
                plain={plain}
                onToggle={() => setOpenId(openId === f.verdict.id ? null : f.verdict.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className={s.beyond}>
        <div className={s.beyondCard}>
          <span className={`mono ${s.beyondLab}`}>
            <Icon name="headphones" size={12} /> Listen rack
          </span>
          <p>
            Audition these fixes on your own track first: the Listen rack plays it through a
            real-time EQ, compressor and stereo-width chain, so you can A/B every change against
            the original before you touch your DAW.
          </p>
        </div>
        <div className={s.beyondCard}>
          <span className={`mono ${s.beyondLab}`}>
            <Icon name="message" size={12} /> Coach
          </span>
          <p>Ask follow-up questions. The coach answers from this report&rsquo;s measurements.</p>
          <ul className={s.questions} aria-label="Questions the coach suggests for this report">
            {questions.map((q) => (
              <li key={q} className="mono">{q}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

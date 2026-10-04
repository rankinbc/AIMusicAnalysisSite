/* Workflow vignettes, each modelled on its real surface: the DAW Plan export
 * (real sample-report fixes), the report's Track Analysis panels (real
 * sample-report measurements), and two illustrations with made-up values —
 * the song page (decks, what changed, versions) and the optional inputs. */
import { useState } from 'react';
import type { CSSProperties } from 'react';

import { HEAR_FIXES, LIMITER_FIX } from '../features-content';
import {
  ILLUSTRATION_PROJECT, ILLUSTRATION_SONG, ILLUSTRATION_STEMS, ILLUSTRATION_UPLOAD,
  SAMPLE_STATS,
} from '../vignette-data';
import k from './kit.module.css';
import s from './workflow-vignettes.module.css';

const PLAN_STEPS = [
  ...HEAR_FIXES.map((f) => ({ title: f.headline, device: f.device, settings: f.does })),
  {
    title: LIMITER_FIX.finding,
    device: LIMITER_FIX.device,
    settings: LIMITER_FIX.params.map((p) => `${p.label} ${p.value}`).join(' · '),
  },
];

export function DawPlanVignette() {
  const [done, setDone] = useState<boolean[]>(() => PLAN_STEPS.map((_, i) => i === 0));
  const count = done.filter(Boolean).length;
  return (
    <div className={s.plan}>
      <div className={k.row}>
        <span className={k.lbl}>DAW Plan · build your export</span>
        <span className={`${k.seg} ${k.push}`} role="img" aria-label="Format: Markdown">
          <span className={k.segItem} data-on="true">Markdown</span>
          <span className={k.segItem}>Plain text</span>
        </span>
      </div>
      <div className={s.planDoc}>
        <div className={s.planHead}>
          <span className={`mono ${s.planFile}`}># Mixing plan — Sample track</span>
          <span className={`mono ${s.planCount}`}>{count} of {PLAN_STEPS.length} done</span>
        </div>
        <ol className={s.planList}>
          {PLAN_STEPS.map((step, i) => (
            <li key={step.title} className={s.planStep} data-done={Boolean(done[i])}>
              <label className={s.planLabel}>
                <input
                  type="checkbox"
                  className={s.planCheck}
                  checked={Boolean(done[i])}
                  onChange={() => setDone((prev) => prev.map((v, j) => (j === i ? !v : v)))}
                />
                <span className={s.planTitle}>{step.title} <span className={s.planScope}>(Master)</span></span>
              </label>
              <span className={`mono ${s.planSettings}`}>{step.device}: {step.settings}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className={k.row}>
        <span className={`${k.btn} ${k.push}`} data-tone="solid">⇣ Export DAW Plan</span>
      </div>
    </div>
  );
}

const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
// Loudness bar scale (LUFS), as the report draws it: −24 … 0, reference marker at −14.
const lufsPct = (v: number) => ((Math.max(-24, Math.min(0, v)) + 24) / 24) * 100;

export function AnalysisVignette() {
  const st = SAMPLE_STATS;
  return (
    <div className={s.analysis}>
      <div className={k.row}>
        <span className={k.chip}>KEY <b>{st.key}</b></span>
        <span className={k.chip}>LOUDNESS RANGE <b>{st.loudnessRangeLu.toFixed(1)}</b> LU</span>
      </div>

      <div className={k.panel}>
        <div className={k.panelHead}>
          <span className={k.panelTitle}>Loudness &amp; dynamics</span>
          <span className={k.panelMeta}>phase1.lufs · true_peak_db</span>
        </div>
        <div className={k.panelBody}>
          <div className={s.lufs} aria-hidden="true">
            <span className={`mono ${s.lufsValue}`} style={{ left: `${lufsPct(st.lufs)}%` }}>{signed(st.lufs)} LUFS</span>
            <span className={s.lufsTrack}>
              <span className={s.lufsFill} style={{ width: `${lufsPct(st.lufs)}%` }} />
              <span className={s.lufsMark} style={{ left: `${lufsPct(-14)}%` }} />
            </span>
            <span className={`mono ${s.lufsStream}`} style={{ left: `${lufsPct(-14)}%` }}>−14</span>
          </div>
          <div className={k.row}>
            <span className={k.chip} data-tone="orange">TRUE PEAK <b>{signed(st.truePeakDb)}</b> dBTP · over 0</span>
          </div>
        </div>
      </div>

      <div className={s.pair}>
        <div className={k.panel}>
          <div className={k.panelHead}>
            <span className={k.panelTitle}>Punch &amp; transients</span>
          </div>
          <div className={k.panelBody}>
            <div className={s.meter}>
              <span>Crest factor</span>
              <span className="mono">{st.crestFactorDb.toFixed(1)} dB</span>
              <span className={s.meterTrack} aria-hidden="true">
                <span className={s.meterMark} style={{ left: `${(st.crestFactorDb / 20) * 100}%` }} />
              </span>
            </div>
          </div>
        </div>
        <div className={k.panel}>
          <div className={k.panelHead}>
            <span className={k.panelTitle}>Stereo field</span>
          </div>
          <div className={k.panelBody}>
            <div className={s.meter}>
              <span>Correlation</span>
              <span className="mono">{signed(st.stereoCorrelation, 2)}</span>
              <span className={s.meterTrack} aria-hidden="true">
                <span className={s.meterMark} style={{ left: `${((st.stereoCorrelation + 1) / 2) * 100}%` }} />
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

// Decorative waveform blocks for the two decks.
const WAVE = [5, 8, 6, 9, 4, 4, 6, 10, 12, 7, 6, 9, 5, 4, 8, 11, 9, 6, 5, 7, 12, 10, 6, 4, 5, 9, 8, 6];

export function LibraryVignette() {
  const [deck, setDeck] = useState<'a' | 'b'>('b');
  const song = ILLUSTRATION_SONG;
  const label = (v: string) => song.versions.find((x) => x.v === v)?.label ?? '';
  return (
    <div className={s.library}>
      <div className={k.row}>
        <span className={s.songTitle}>{song.title}</span>
        {song.tags.map((t) => (
          <span key={t} className={k.chip}>{t}</span>
        ))}
        <span className={`${k.lbl} ${k.push}`}>{song.versions.length} versions</span>
      </div>

      <span className={k.lbl}>Quick audition · A / B</span>
      <div className={s.decks} role="group" aria-label="Quick audition — choose which version you hear">
        {(['a', 'b'] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={s.deck}
            aria-label={`Deck ${d.toUpperCase()}, ${song.decks[d]}`}
            aria-pressed={deck === d}
            onClick={() => setDeck(d)}
          >
            <span className={s.deckLetter}>{d.toUpperCase()}</span>
            <span className={s.deckPlay} aria-hidden="true">{deck === d ? '❚❚' : '▶'}</span>
            <span className={s.deckBody}>
              <span className={`mono ${s.deckVersion}`}><b>{song.decks[d]}</b> {label(song.decks[d])}</span>
              <span className={s.wave} aria-hidden="true">
                {WAVE.map((h, i) => (
                  <span key={i} style={{ '--h': `${(d === 'a' ? h : WAVE[(i + 9) % WAVE.length]!) * 7}%` } as CSSProperties} />
                ))}
              </span>
            </span>
          </button>
        ))}
      </div>

      <span className={k.lbl}>
        What changed · A·{song.decks.a} vs B·{song.decks.b}
      </span>
      <ul className={s.changes}>
        {song.changes.map((c) => (
          <li key={c.label} className={s.change}>
            <span className={k.lbl}>{c.label}</span>
            <span className={`mono ${s.changeValues}`}><b>{c.a}</b> vs {c.b} {c.unit}</span>
            <span className={`mono ${s.changeDelta}`} data-tone={c.tone}>{c.delta}</span>
          </li>
        ))}
      </ul>

      <p className={s.verdict}>
        <span className={s.verdictLabel}>▲ you rate B higher</span>
        {song.note}
      </p>

      <ul className={s.versions}>
        {[...song.versions].reverse().map((v) => (
          <li key={v.v} className={s.version}>
            <span className={`mono ${s.versionNo}`}>{v.v}</span>
            <span className={s.versionLabel}>{v.label}</span>
            {'current' in v && <span className={s.current}>current</span>}
            <span className={`mono ${s.versionState}`}>✓ analyzed</span>
            <span className={`mono ${s.versionDate}`}>{v.date}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DEEPER_TABS = [
  { id: 'upload', label: 'Upload' },
  { id: 'stems', label: 'Stems' },
  { id: 'project', label: 'Ableton project' },
] as const;
type DeeperTab = (typeof DEEPER_TABS)[number]['id'];

export function DeeperVignette() {
  const [tab, setTab] = useState<DeeperTab>('upload');
  const stems = ILLUSTRATION_STEMS;
  const up = ILLUSTRATION_UPLOAD;
  return (
    <div className={s.deeper}>
      <div className={s.deeperTabs} role="group" aria-label="The upload, and what each input unlocks">
        {DEEPER_TABS.map((t) => (
          <button key={t.id} type="button" className={s.deeperTab} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.id === 'upload' ? t.label : `+ ${t.label}`}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <div className={s.deeperBody}>
          <span className={s.dialogTitle}>New track</span>

          <div className={s.zone}>
            <span className={k.lbl}>Mix · required</span>
            <span className={`mono ${s.file}`}>✓ {up.mix}</span>
          </div>

          <div className={s.zone}>
            <div className={k.row}>
              <span className={k.lbl}>Ableton project</span>
              <span className={s.recommended}>Recommended</span>
              <span className={`${k.chip} ${k.push}`}>Track &amp; device-specific insights</span>
            </div>
            <span className={`mono ${s.file}`}>✓ {up.project.file}</span>
            <span className={`mono ${s.fileFacts}`}>{up.project.facts}</span>
          </div>

          <div className={s.zone}>
            <div className={k.row}>
              <span className={k.lbl}>Stems</span>
              <span className={`mono ${s.fileFacts} ${k.push}`}>{up.stems.length} stems · roles detected</span>
            </div>
            <ul className={s.stemRoles}>
              {up.stems.map((st) => (
                <li key={st.file} className={s.stemRole}>
                  <span className={`mono ${s.stemFile}`}>{st.file}</span>
                  <span className={s.roleChip}>{st.role}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className={k.row}>
            <span className={`${k.btn} ${k.push}`} data-tone="solid">Upload &amp; analyze</span>
          </div>
        </div>
      )}

      {tab === 'stems' && (
        <div className={s.deeperBody}>
          <span className={k.lbl}>Band overlap map</span>
          <div className={s.overlap} style={{ '--cols': stems.bands.length } as CSSProperties}>
            <span />
            {stems.bands.map((b) => (
              <span key={b} className={s.overlapBand}>{b}</span>
            ))}
            {stems.rows.map((r) => (
              <div key={r.stem} className={s.overlapRow}>
                <span className={s.overlapStem}>{r.stem}</span>
                {r.energy.map((e, i) => (
                  <span
                    key={i}
                    className={s.cell}
                    data-level={e}
                    data-clash={i === stems.clashBand && (stems.clashStems as readonly string[]).includes(r.stem)}
                  />
                ))}
              </div>
            ))}
          </div>
          <p className={s.deeperFinding}><span className={k.lbl}>Per-stem finding</span>{stems.finding}</p>
        </div>
      )}

      {tab === 'project' && (
        <div className={s.deeperBody}>
          <span className={k.lbl}>Tracks</span>
          <p className={s.trackChain}>
            <span className={s.trackName}>{ILLUSTRATION_PROJECT.track}</span>
            {ILLUSTRATION_PROJECT.chain.map((d) => (
              <span key={d} className={k.chip}>{d}</span>
            ))}
          </p>
          <p className={s.deeperFinding}><span className={k.lbl}>Finding</span>{ILLUSTRATION_PROJECT.finding}</p>
          <p className={s.deeperFinding}><span className={k.lbl} data-tone="cyan">Fix, on your track</span>{ILLUSTRATION_PROJECT.fix}</p>
        </div>
      )}
    </div>
  );
}

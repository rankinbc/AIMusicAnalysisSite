// Analysis tab — the run overview: what's still working, where to start, what
// went in, which pipeline modules ran, and which specialists looked at the mix
// (with a per-finding severity meter for each one that ran).

import type { CSSProperties } from 'react';

import type { FinalJson, VerdictsListResponse, VersionFileEntry } from '../../api/types';
import {
  buildInputRows,
  buildModuleRows,
  buildSpecialistRows,
  pickTopTips,
  type InProgressItem,
  type InputKind,
  type ModuleStatus,
  type SpecialistRow,
} from './analysis-tab-model';
import { severityColor } from './helpers/severity';
import { groupColor } from './helpers/specialists';
import './analysis-tab.css';

interface AnalysisTabProps {
  fj: FinalJson;
  songName: string;
  files: VersionFileEntry[] | undefined;
  verdictsData: VerdictsListResponse | undefined;
  runningSlugs: ReadonlySet<string>;
  hasStems: boolean;
  inProgress: InProgressItem[];
  onAddInputs: (key?: InputKind) => void;
}

const TIP_SEV: Record<string, string> = { crit: 'critical', mod: 'moderate', min: 'minor' };
const MODULE_GLYPH: Record<ModuleStatus, string> = { ok: '✓', skipped: '–', failed: '×', running: '' };
const MODULE_STATE_TEXT: Record<ModuleStatus, string> = {
  ok: 'ran',
  skipped: 'skipped',
  failed: 'failed',
  running: 'running',
};
// Past this many segments a meter would wrap; the count still carries the total.
const METER_MAX = 24;

function EqDots() {
  return (
    <span className="eqdots" aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function FindingMeter({ severities }: { severities: string[] }) {
  const shown = severities.slice(0, METER_MAX);
  return (
    <span className="ax-meter" aria-hidden>
      {shown.map((s, i) => (
        <i key={i} style={{ ['--c' as string]: severityColor(s) } as CSSProperties} />
      ))}
      {severities.length > METER_MAX && <span className="ax-meter-more">+</span>}
    </span>
  );
}

function SpecRow({ row }: { row: SpecialistRow }) {
  const dot = { ['--gc' as string]: groupColor(row.group) } as CSSProperties;
  return (
    <li className={`ax-spec ${row.state}`}>
      <span className="ax-spec-name">
        <span className="ax-gdot" style={dot} aria-hidden />
        {row.label}
      </span>
      {row.state === 'ran' && (
        <span className="ax-spec-val">
          <FindingMeter severities={row.severities} />
          <span className="ax-count mono">
            {row.count}
            <span className="sr-only"> {row.count === 1 ? 'finding' : 'findings'}</span>
          </span>
        </span>
      )}
      {row.state === 'running' && (
        <span className="ax-spec-val ax-live-val">
          <EqDots />
          listening
        </span>
      )}
      {row.state === 'no-findings' && <span className="ax-spec-val ax-quiet">didn&rsquo;t return findings</span>}
      {row.state === 'suggested' && <span className="ax-spec-val ax-sugg">suggested</span>}
      {row.state === 'needs-stems' && <span className="ax-spec-val ax-quiet">needs stems</span>}
      {row.focus && <p className="ax-focus">{row.focus}</p>}
    </li>
  );
}

export function AnalysisTab({
  fj,
  songName,
  files,
  verdictsData,
  runningSlugs,
  hasStems,
  inProgress,
  onAddInputs,
}: AnalysisTabProps) {
  const tips = pickTopTips(fj);
  const inputs = buildInputRows(fj, files, songName);
  const modules = buildModuleRows(fj);
  const specs = buildSpecialistRows({ data: verdictsData, running: runningSlugs, hasStems });
  const inputsUsed = inputs.filter((r) => r.state === 'analyzed').length;
  const modulesRan = modules.filter((m) => m.status === 'ok').length;

  return (
    <div className="tabbody fade-up ax">
      {inProgress.length > 0 && (
        <div className="ax-live" role="status" aria-live="polite">
          <EqDots />
          <span className="ax-live-t">Still working</span>
          <ul className="ax-live-list">
            {inProgress.map((item) => (
              <li key={item.key}>{item.label}</li>
            ))}
          </ul>
        </div>
      )}

      {tips.length > 0 && (
        <section className="card ax-tips" aria-labelledby="ax-tips-h">
          <div className="card-hd">
            <h3 className="t" id="ax-tips-h">
              <span className="led" />
              Start here
            </h3>
            <span className="meta">From the first pass over your mix</span>
          </div>
          <ol className="ax-tiplist">
            {tips.map((t, i) => (
              <li
                key={`${t.cat}-${i}`}
                className="ax-tip"
                style={{ ['--sev' as string]: severityColor(TIP_SEV[t.sev] ?? 'minor') } as CSSProperties}
              >
                <span className="ax-tipn mono" aria-hidden>
                  {i + 1}
                </span>
                <div className="ax-tipb">
                  <div className="ax-tipt">{t.title}</div>
                  <div className="ax-tipd">{t.body}</div>
                </div>
                {/* A long single-sentence fix gets its category as the title —
                    don't print it twice. */}
                {t.cat !== t.title && <span className="ax-tipc">{t.cat}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="ax-grid">
        <section className="card ax-specs" aria-labelledby="ax-specs-h">
          <div className="card-hd">
            <h3 className="t" id="ax-specs-h">
              Specialists
            </h3>
            <span className="meta">
              {specs.ran} ran{specs.suggested > 0 ? ` · ${specs.suggested} suggested` : ''}
            </span>
          </div>
          <ul className="ax-speclist">
            <li className="ax-spec builtin">
              <span className="ax-spec-name">
                <span className="ax-gdot" aria-hidden />
                Built-in checks
              </span>
              <span className="ax-spec-val">
                <FindingMeter severities={specs.builtIn.severities} />
                <span className="ax-count mono">
                  {specs.builtIn.count}
                  <span className="sr-only"> {specs.builtIn.count === 1 ? 'finding' : 'findings'}</span>
                </span>
              </span>
              <p className="ax-focus">Automatic measurements run on every analysis.</p>
            </li>
            {specs.rows.map((row) => (
              <SpecRow key={row.slug} row={row} />
            ))}
          </ul>
          {specs.triage === 'pending' && specs.rows.length === 0 && (
            <p className="ax-note">Specialists are picked once the first pass is read.</p>
          )}
          {specs.triage === 'unavailable' && specs.rows.length === 0 && (
            <p className="ax-note">Specialist suggestions aren&rsquo;t available for this run.</p>
          )}
          {specs.otherAvailable > 0 && (
            <p className="ax-note">
              {specs.otherAvailable} more specialists can be run from the Coach panel.
            </p>
          )}
        </section>

        <section className="card ax-inputs" aria-labelledby="ax-inputs-h">
          <div className="card-hd">
            <h3 className="t" id="ax-inputs-h">
              What went in
            </h3>
            <span className="meta">
              {inputsUsed} of {inputs.length} inputs
            </span>
          </div>
          <ul className="ax-inlist">
            {inputs.map((r) => (
              <li key={r.kind} className={`ax-in ${r.state}`}>
                <span className="ax-jack" aria-hidden />
                <span className="ax-in-k">{r.label}</span>
                <span className="ax-in-v">
                  <span className="sr-only">
                    {r.state === 'analyzed' ? 'Analyzed. ' : r.state === 'failed' ? 'Failed. ' : r.state === 'attached' ? 'Not analyzed. ' : 'Not included. '}
                  </span>
                  {r.detail}
                </span>
                {r.kind !== 'mix' && r.state === 'missing' && (
                  <button type="button" className="ax-add" onClick={() => onAddInputs(r.kind)}>
                    Add
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card ax-modules" aria-labelledby="ax-modules-h">
          <div className="card-hd">
            <h3 className="t" id="ax-modules-h">
              What ran
            </h3>
            <span className="meta">
              {modulesRan} of {modules.length} modules
            </span>
          </div>
          <ul className="ax-modlist">
            {modules.map((m) => (
              <li key={m.phase} className={`ax-mod ${m.status}`}>
                <span className="ax-mod-st" aria-hidden>
                  {m.status === 'running' ? <EqDots /> : MODULE_GLYPH[m.status]}
                </span>
                <span className="ax-mod-k">
                  {m.label}
                  <span className="sr-only">, {MODULE_STATE_TEXT[m.status]}</span>
                </span>
                <span className="ax-mod-v mono">{m.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

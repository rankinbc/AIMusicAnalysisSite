// The analysis page's live findings list (right column, under the AI
// specialists): the static analysis' (rule-engine) findings, to read while
// the run finishes. It re-derives from the verdicts poll, so rows appear as
// they land, ordered by severity then priority. (Each AI specialist lists its
// own findings in its coach-chat message instead.) A row is the report's
// finding card in miniature — severity badge (same `--sev-*` tokens),
// headline, area — and expands to the explanation. The report's Findings tab
// styles live under `.rdx`, which this portalled page is outside of, so the
// look is a CSS module here.

import { useMemo, useState } from 'react';

import type { VerdictDto } from '../../api/types';
import { findingArea, findingDetail, ruleFindings } from './helpers/liveFindings';
import { severityColor, severityLabel } from './helpers/severity';
import s from './LiveFindingsList.module.css';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

function sevTitle(sev: string): string {
  const label = severityLabel(sev);
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

function FindingRow({ v }: { v: VerdictDto }) {
  const [open, setOpen] = useState(false);
  const detail = findingDetail(v);
  const panelId = `lf-detail-${v.id}`;
  return (
    <li
      className={cx(s.row, open && s.open)}
      style={{ '--sev': severityColor(String(v.severity)) } as React.CSSProperties}
      data-testid="lf-row"
      data-finding-id={v.id}
      data-severity={v.severity}
    >
      <button
        type="button"
        className={s.rowHd}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={s.sev}>{sevTitle(String(v.severity))}</span>
        <span className={s.head}>{v.headline}</span>
        <span className={s.src} data-testid="lf-source">
          {findingArea(v)}
        </span>
        <span className={s.chev} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className={s.detail} id={panelId} data-testid="lf-detail">
          {detail.text.length === 0 && !detail.why && !detail.metric ? (
            <p className={s.none}>No further detail — the full report has the context.</p>
          ) : (
            <>
              {detail.text.map((t, i) => (
                <p key={i}>{t}</p>
              ))}
              {detail.why && (
                <p className={s.why}>
                  <span className={s.whyK}>Why it matters</span>
                  {detail.why}
                </p>
              )}
              {detail.metric && <span className={s.metric}>{detail.metric}</span>}
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function LiveFindingsList({ verdicts }: { verdicts: readonly VerdictDto[] | undefined }) {
  const list = useMemo(() => ruleFindings(verdicts), [verdicts]);
  return (
    <section className={s.wrap} data-testid="lf-list" aria-label="Findings">
      <div className={s.label}>
        <span>Findings</span>
        <span className={s.line} />
        <span className={s.count}>{list.length > 0 ? `${list.length} finding${list.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      {list.length === 0 ? (
        <div className={s.empty} data-testid="lf-empty">
          Findings will appear here as they come in.
        </div>
      ) : (
        <ul className={s.list}>
          {list.map((v) => (
            <FindingRow key={v.id} v={v} />
          ))}
        </ul>
      )}
    </section>
  );
}

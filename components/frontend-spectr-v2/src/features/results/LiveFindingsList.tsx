// The analysis page's live findings list (right column, under the AI
// specialists): the static analysis' (rule-engine) findings plus each AI
// specialist's as it settles, to read while the run finishes. It re-derives
// from the verdicts poll, so rows appear as they land, ordered by severity
// then priority (helpers/liveFindings.listFindings). A row is the report's
// finding card in miniature — severity badge (same `--sev-*` tokens),
// headline, source (the area for rule rows; the specialist with its tint and
// bot head for specialist rows) — and expands to the explanation. The report's Findings tab
// styles live under `.rdx`, which this portalled page is outside of, so the
// look is a CSS module here.

import { useMemo, useState } from 'react';

import type { VerdictDto } from '../../api/types';
import { SpecialistHead } from './AnalysisCompleteStage';
import { findingDetail, findingSource, listFindings, type ListFinding } from './helpers/liveFindings';
import { severityColor, severityLabel } from './helpers/severity';
import { groupColor } from './helpers/specialists';
import s from './LiveFindingsList.module.css';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

function sevTitle(sev: string): string {
  const label = severityLabel(sev);
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

function SourceLabel({ v }: { v: VerdictDto }) {
  const src = findingSource(v);
  if (src.kind === 'rules') {
    return (
      <span className={s.src} data-testid="lf-source" data-source="rules">
        {src.label}
      </span>
    );
  }
  return (
    <span
      className={cx(s.src, s.spec)}
      style={{ color: groupColor(src.group) }}
      data-testid="lf-source"
      data-source="specialist"
    >
      <SpecialistHead row={src} size={16} />
      {src.label}
    </span>
  );
}

function FindingRow({ f }: { f: ListFinding }) {
  const { v, refines } = f;
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
        <SourceLabel v={v} />
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
          {refines && (
            <p className={s.refines} data-testid="lf-refines">
              Refines the measured finding “{refines.headline}”.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function LiveFindingsList({ verdicts }: { verdicts: readonly VerdictDto[] | undefined }) {
  const list = useMemo(() => listFindings(verdicts), [verdicts]);
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
          {list.map((f) => (
            <FindingRow key={f.v.id} f={f} />
          ))}
        </ul>
      )}
    </section>
  );
}

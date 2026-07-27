import { useMemo, useState } from 'react';

import { Icon } from './Icon';
import type { Move } from './move-model';
import {
  DEFAULT_EXPORT_OPTS,
  generateGamePlan,
  type ExportConfig,
  type ExportDetail,
  type ExportFormat,
  type ExportOptKey,
  type ExportOrder,
} from './export-generator';

export interface ExportFacts {
  bpm?: number | null | undefined;
  key?: string | null | undefined;
  lufs?: number | null | undefined;
  genre?: string | null | undefined;
}

interface ExportModalProps {
  committed: Move[];
  trackName: string;
  versionLabel?: string | null | undefined;
  facts?: ExportFacts;
  onClose: () => void;
  /** v4: the config drives the emitted file — the callback receives it. */
  onDownload: (cfg: ExportConfig) => void;
}

/** DAW Plan · build-your-export (prototype `.gp-modal`): a config panel on the
 *  left and a live preview on the right. The preview and the downloaded file
 *  come from the SAME generator (export-generator.ts) — one source of truth.
 *  PDF was dropped (md/txt now; PDF deferred). */
export function ExportModal({
  committed,
  trackName,
  versionLabel,
  facts,
  onClose,
  onDownload,
}: ExportModalProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(committed.map((m) => m.id)),
  );
  const [format, setFormat] = useState<ExportFormat>('md');
  const [detail, setDetail] = useState<ExportDetail>('standard');
  const [order, setOrder] = useState<ExportOrder>('order');
  const [opts, setOpts] = useState<Record<ExportOptKey, boolean>>(DEFAULT_EXPORT_OPTS);

  const toggle = (id: string) =>
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const setOpt = (k: ExportOptKey) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  const cfg: ExportConfig = useMemo(
    () => ({ format, detail, order, opts, selectedIds: checked }),
    [format, detail, order, opts, checked],
  );
  const result = useMemo(
    () => generateGamePlan(cfg, committed, facts ?? {}, { trackName, versionLabel }),
    [cfg, committed, facts, trackName, versionLabel],
  );
  const selCount = committed.filter((m) => checked.has(m.id)).length;
  const optCount = Object.values(opts).filter(Boolean).length;

  const seg = <T extends string>(
    value: T,
    set: (v: T) => void,
    options: [T, string][],
  ) => (
    <div className="gp-seg">
      {options.map(([v, l]) => (
        <button key={v} type="button" className={value === v ? 'on' : ''} onClick={() => set(v)}>
          {l}
        </button>
      ))}
    </div>
  );

  const OptRow = ({ k, label, sub }: { k: ExportOptKey; label: string; sub: string }) => (
    <label className="gp-opt">
      <input type="checkbox" checked={opts[k]} onChange={() => setOpt(k)} />
      <span className="gp-opt-b">
        <span className="gp-opt-l">{label}</span>
        <span className="gp-opt-s">{sub}</span>
      </span>
    </label>
  );

  return (
    <div className="modal-scrim" onClick={onClose} role="presentation">
      <div
        className="modal gp-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="DAW Plan export"
      >
        <div className="modal-hd">
          <div className="mt">
            <div className="mk">DAW Plan · build your export</div>
            <div className="mn">
              {trackName}{' '}
              {versionLabel && (
                <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
                  {versionLabel}
                </span>
              )}
            </div>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="modal-body gp-body">
          <div className="gp-config">
            <div className="gp-sec">
              <div className="gp-sec-h">Format</div>
              {seg<ExportFormat>(format, setFormat, [
                ['md', 'Markdown'],
                ['txt', 'Plain text'],
              ])}
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">Detail level</div>
              {seg<ExportDetail>(detail, setDetail, [
                ['brief', 'Brief'],
                ['standard', 'Standard'],
                ['detailed', 'Detailed'],
              ])}
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">Order fixes by</div>
              {seg<ExportOrder>(order, setOrder, [
                ['order', 'Signal chain'],
                ['area', 'Problem area'],
              ])}
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">Include</div>
              <div className="gp-opts">
                <OptRow k="facts" label="Track facts" sub="tempo · key · LUFS · genre" />
                <OptRow k="params" label="Device parameters" sub="the suggested rack settings per fix" />
                <OptRow k="data" label="Measured evidence" sub="the numbers each fix is based on" />
                <OptRow k="targets" label="Streaming targets" sub="platform LUFS / true-peak goals" />
                <OptRow k="coach" label="Coach commentary" sub="the why-it-matters context" />
                <OptRow k="perDevice" label="Actions per device" sub="Master first, then each named device" />
              </div>
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">
                Fixes <span className="gp-sec-c">{selCount}/{committed.length}</span>
              </div>
              <div className="gp-fixlist">
                {committed.map((m) => {
                  const on = checked.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`gp-fix${on ? ' on' : ''}`}
                      onClick={() => toggle(m.id)}
                    >
                      <span className="gp-fix-ck">{on && <Icon name="check" size={10} />}</span>
                      <span className="gp-fix-t">{m.title}</span>
                      <span className="gp-fix-scope mono">{m.scope}</span>
                    </button>
                  );
                })}
                {committed.length === 0 && (
                  <div className="gp-doc-empty">Queue fixes from the findings board to export them.</div>
                )}
              </div>
            </div>
          </div>

          <div className="gp-preview">
            <div className="gp-pv-bar">
              <span className="mono">{result.filename}</span>
              <span className="gp-pv-tag">{format.toUpperCase()} · live preview</span>
            </div>
            <div className="gp-doc">
              <pre className="gp-doc-pre">{result.content}</pre>
            </div>
          </div>
        </div>

        <div className="spec-foot">
          <span className="sf-note">
            <span className="v">{selCount}</span> {selCount === 1 ? 'fix' : 'fixes'} · {optCount}{' '}
            sections · {format.toUpperCase()}
          </span>
          <button
            type="button"
            className="btn primary sm"
            disabled={selCount === 0}
            onClick={() => onDownload(cfg)}
          >
            <Icon name="download" size={13} />
            Download .{format}
          </button>
        </div>
      </div>
    </div>
  );
}

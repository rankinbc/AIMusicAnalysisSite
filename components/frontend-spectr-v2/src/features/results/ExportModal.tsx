import { useMemo, useState } from 'react';

import { Icon } from './Icon';
import type { Move } from './move-model';

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
  onDownload: () => void;
}

type Format = 'md' | 'txt' | 'pdf';
type Detail = 'brief' | 'standard' | 'detailed';
type OrderBy = 'order' | 'area';
type OptKey = 'facts' | 'params' | 'data' | 'targets' | 'coach';

// Static platform loudness targets (the prototype's scenario.streaming top 3).
const STREAM_TARGETS: { platform: string; target: number }[] = [
  { platform: 'Spotify', target: -14 },
  { platform: 'Apple Music', target: -16 },
  { platform: 'YouTube', target: -14 },
];

/** DAW Plan · build-your-export (prototype `.gp-modal`): a config panel on the
 *  left (format · detail · order · include · fix selection) and a live document
 *  preview on the right that updates as options toggle. Download emits the real
 *  committed-moves Game Plan markdown. */
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
  const [format, setFormat] = useState<Format>('md');
  const [detail, setDetail] = useState<Detail>('standard');
  const [order, setOrder] = useState<OrderBy>('order');
  const [opts, setOpts] = useState<Record<OptKey, boolean>>({
    facts: true,
    params: true,
    data: true,
    targets: true,
    coach: false,
  });

  const toggle = (id: string) =>
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const setOpt = (k: OptKey) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  const sel = useMemo(() => {
    const list = committed.filter((m) => checked.has(m.id));
    if (order === 'area') {
      return [...list].sort((a, b) => a.scope.localeCompare(b.scope));
    }
    return list;
  }, [committed, checked, order]);

  const ext = format === 'md' ? '.md' : format === 'txt' ? '.txt' : '.pdf';
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

  const OptRow = ({ k, label, sub }: { k: OptKey; label: string; sub: string }) => (
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
              {seg<Format>(format, setFormat, [
                ['md', 'Markdown'],
                ['txt', 'Plain text'],
                ['pdf', 'PDF'],
              ])}
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">Detail level</div>
              {seg<Detail>(detail, setDetail, [
                ['brief', 'Brief'],
                ['standard', 'Standard'],
                ['detailed', 'Detailed'],
              ])}
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">Order fixes by</div>
              {seg<OrderBy>(order, setOrder, [
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
              </div>
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">
                Fixes <span className="gp-sec-c">{sel.length}/{committed.length}</span>
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
              <span className="mono">
                DAW-Plan-{trackName}
                {ext}
              </span>
              <span className="gp-pv-tag">{format.toUpperCase()} · live preview</span>
            </div>
            <div className="gp-doc">
              <div className="gp-doc-h1">
                # Mixing plan — {trackName}
                {versionLabel && <span className="dim"> {versionLabel}</span>}
              </div>
              {opts.facts && (
                <div className="gp-doc-block">
                  <div className="gp-doc-h2">Track facts</div>
                  <div className="gp-doc-kv">
                    <span>Tempo</span>
                    <b>{facts?.bpm != null ? `${Math.round(facts.bpm)} BPM` : '—'}</b>
                  </div>
                  <div className="gp-doc-kv">
                    <span>Key</span>
                    <b>{facts?.key || '—'}</b>
                  </div>
                  <div className="gp-doc-kv">
                    <span>Loudness</span>
                    <b>{facts?.lufs != null ? `${facts.lufs.toFixed(1)} LUFS` : '—'}</b>
                  </div>
                  <div className="gp-doc-kv">
                    <span>Genre</span>
                    <b>{facts?.genre || '—'}</b>
                  </div>
                </div>
              )}
              <div className="gp-doc-block">
                <div className="gp-doc-h2">
                  Moves <span className="dim">· by {order === 'order' ? 'signal chain' : 'problem area'}</span>
                </div>
                {sel.length === 0 ? (
                  <div className="gp-doc-empty">No fixes selected — pick some on the left.</div>
                ) : (
                  sel.map((m, i) => (
                    <div className="gp-doc-move" key={m.id}>
                      <div className="gp-doc-move-t">
                        {i + 1}. {m.title} {m.scope && <span className="dim mono">{m.scope}</span>}
                      </div>
                      {detail !== 'brief' && <div className="gp-doc-move-d">{m.directive}</div>}
                      {opts.params && m.steps.length > 0 && (
                        <div className="gp-doc-params">
                          {m.steps.map((st, j) => (
                            <span className="gp-doc-chip mono" key={j}>
                              {st.where}
                              {detail === 'detailed' && st.detail ? ` · ${st.detail}` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {opts.data && m.evidence.metric && detail === 'detailed' && (
                        <div className="gp-doc-data mono">↳ {m.evidence.metric}</div>
                      )}
                      {opts.coach && m.why && detail !== 'brief' && (
                        <div className="gp-doc-why">{m.why}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
              {opts.targets && (
                <div className="gp-doc-block">
                  <div className="gp-doc-h2">Streaming targets</div>
                  {STREAM_TARGETS.map((r) => (
                    <div className="gp-doc-kv" key={r.platform}>
                      <span>{r.platform}</span>
                      <b>{r.target} LUFS</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="spec-foot">
          <span className="sf-note">
            <span className="v">{sel.length}</span> {sel.length === 1 ? 'fix' : 'fixes'} · {optCount}{' '}
            sections · {format.toUpperCase()}
          </span>
          <button
            type="button"
            className="btn primary sm"
            disabled={sel.length === 0}
            onClick={onDownload}
          >
            <Icon name="download" size={13} />
            Download {ext}
          </button>
        </div>
      </div>
    </div>
  );
}

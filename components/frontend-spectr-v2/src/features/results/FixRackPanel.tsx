import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { MANIFEST, enabledModuleIds, moduleParams, readFixChain } from './fix-rack-helpers';
import { useFixRackGeneration, type FixRackGenPhase } from './useFixRackGeneration';
import s from './FixRackPanel.module.css';

// Phase 2 "act on them": committed fixable Moves -> a mastering chain you hear in
// Listen. POST /reports/{jobId}/fix-rack (202) -> poll GET (204 -> 200 FixRackDto).
// The chain is byte-identical to the Listen rack's, so "Open in Listen rack" hands
// it straight over. The change_log / degraded coaching layer is rendered from
// the BFF `coachMeta` (coach-mix arbiter rationale). Generation lifecycle
// (including the error/timeout failure paths) lives in useFixRackGeneration.

interface Props {
  jobId: string;
  versionId: string | null;
  /** Number of committed moves — gates idle vs empty. */
  committedCount: number;
  /** Controlled mode (redesign): when provided, the panel reflects the owner's
   *  generation phase and delegates the trigger to `onGenerate` — so the coach
   *  header's "Generate Fix Rack" button and this sidebar panel share one
   *  useFixRackGeneration flow. Omit both for self-contained behavior. */
  genPhase?: FixRackGenPhase;
  onGenerate?: () => void;
}

export function FixRackPanel({ jobId, versionId, committedCount, genPhase, onGenerate }: Props) {
  const navigate = useNavigate();
  const controlled = genPhase !== undefined;
  // In controlled mode the owner's hook instance drives the POST + polling;
  // this instance stays idle but its (disabled) query still subscribes to the
  // shared ['fix-rack', jobId] cache, so `rack` updates in both modes.
  const flow = useFixRackGeneration(jobId);
  const phase = controlled ? genPhase : flow.phase;
  const rack = flow.rack;
  const enabled = useMemo(() => (rack ? enabledModuleIds(rack.chain) : []), [rack]);

  const generate = () => {
    if (controlled) {
      onGenerate?.();
      return;
    }
    flow.generate();
  };
  const openInListen = () => {
    if (!versionId) return;
    // Story 12.4: carry the generated chain by preset id — the Listen page
    // fetches it back and applies it once (see listen-rack route). A stale
    // cached DTO without presetId still navigates (never block the button).
    void navigate({
      to: '/listen-rack/$versionId',
      params: { versionId },
      search: rack?.presetId ? { fixPreset: rack.presetId } : {},
    });
  };

  // ── empty: nothing committed to apply ──
  if (committedCount === 0) {
    return (
      <div className={`card ${s.panel} ${s.empty}`}>
        <span className={`${s.icon} ${s.ok}`}>✓</span>
        <div className={s.body}>
          <div className={s.title}>Nothing to apply</div>
          <div className={s.sub}>Commit a fix above and a generated rack shows up here.</div>
        </div>
      </div>
    );
  }

  // ── ready ──
  // (No empty-chain state: the arbiter always scaffolds at least a ceiling
  // limiter, so a generated rack has >= 1 enabled module by construction.)
  if (rack) {
    const chain = readFixChain(rack.chain)!;
    const meta = rack.coachMeta;
    return (
      <div className={`card ${s.panel} ${s.ready}`}>
        <div className={s.head}>
          <span className={`${s.icon} ${s.done}`}>▣</span>
          <div className={s.body}>
            <div className={s.title}>{rack.name}</div>
            <div className={s.sub}>{enabled.length} modules · from {committedCount} committed moves</div>
          </div>
          <div className={s.actions}>
            <button type="button" className="btn ghost sm" onClick={generate}>Regenerate</button>
            <button type="button" className="btn primary sm" onClick={openInListen} disabled={!versionId}>
              Open in Listen rack
            </button>
          </div>
        </div>

        <div className={`mono ${s.chainbar}`}>
          <span className={s.flowEnd}>in</span>
          {enabled.map((id) => (
            <span key={id} className={s.node} style={{ ['--ac' as string]: MANIFEST.get(id)?.accent ?? 'var(--muted)' }}>
              {MANIFEST.get(id)?.glyph ?? '·'} {MANIFEST.get(id)?.label ?? id}
            </span>
          ))}
          <span className={s.flowEnd}>out</span>
        </div>

        <div className={s.modules}>
          {enabled.map((id) => (
            <div key={id} className={s.mod} style={{ ['--ac' as string]: MANIFEST.get(id)?.accent ?? 'var(--muted)' }}>
              <div className={s.modHead}>
                <span className={s.modGlyph}>{MANIFEST.get(id)?.glyph ?? '·'}</span>
                <span className={s.modLabel}>{MANIFEST.get(id)?.label ?? id}</span>
                <span className={`${s.dot} ${s.on}`} title="enabled in the chain" />
              </div>
              <div className={s.modParams}>
                {moduleParams(id, chain.modules[id]).map((p, i) => (
                  <div key={i} className={s.param}>
                    <span className={s.paramLabel}>{p.label}</span>
                    <span className={`mono ${s.paramVal}`}>{p.val}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Pre-port presets (and unparseable coach_meta) have no meta at all —
            say nothing rather than falsely claim "no changes were needed"
            under a populated chain. */}
        {meta && (
          <div className={s.coach}>
            <span className={s.coachIc}>✦</span>
            <div>
              <div className={s.coachTitle}>
                What Coach did
                {meta.degraded && <span className={s.soon}>used the rule-based master</span>}
              </div>
              {meta.change_log?.length ? (
                <ul className={s.sub}>
                  {meta.change_log.map((c, i) => (
                    <li key={i}><b>{c.module}</b>: {c.change}{c.why && <> &mdash; {c.why}</>}</li>
                  ))}
                </ul>
              ) : (
                <div className={s.sub}>No master-rack changes were needed.</div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── error: the generate POST failed (entitlements 503, worker/Redis down) ──
  if (phase === 'error') {
    return (
      <div className={`card ${s.panel} ${s.empty}`}>
        <span className={`${s.icon} ${s.err}`}>✕</span>
        <div className={s.body}>
          <div className={s.title}>Couldn&apos;t generate the rack</div>
          <div className={s.sub}>The generate request failed — nothing was queued. Retry when the service is back.</div>
        </div>
        <button type="button" className="btn primary sm" onClick={generate}>
          Retry
        </button>
      </div>
    );
  }

  // ── timeout: queued, but no preset landed inside the poll window ──
  if (phase === 'timeout') {
    return (
      <div className={`card ${s.panel} ${s.empty}`}>
        <span className={`${s.icon} ${s.err}`}>◴</span>
        <div className={s.body}>
          <div className={s.title}>This is taking longer than expected</div>
          <div className={s.sub}>The worker hasn&apos;t produced a rack yet — it may be busy or down. Retry to queue it again.</div>
        </div>
        <button type="button" className="btn primary sm" onClick={generate}>
          Retry
        </button>
      </div>
    );
  }

  // ── generating ──
  if (phase === 'generating') {
    return (
      <div className={`card ${s.panel} ${s.generating}`}>
        <span className={`${s.icon} ${s.busy}`}>◴</span>
        <div className={s.body}>
          <div className={s.title}>Solving your chain…</div>
          <div className={s.sub}>Ordering modules and dialing settings from your committed moves — this runs on a worker.</div>
        </div>
      </div>
    );
  }

  // ── idle ──
  return (
    <div className={`card ${s.panel} ${s.idle}`}>
      <span className={s.icon}>▥</span>
      <div className={s.body}>
        <div className={s.title}>Generate fix rack</div>
        <div className={s.sub}>
          Bundle your committed fixes into a mastering chain you can hear in Listen — built from{' '}
          <b>{committedCount}</b> {committedCount === 1 ? 'move' : 'moves'}.
        </div>
      </div>
      <button type="button" className="btn primary sm" onClick={generate} disabled={flow.isPosting}>
        ✦ Generate
      </button>
    </div>
  );
}

/* Listen Rack v2 — Coach tab: coach moves + fixes-from-analysis, side by side.
 * Ported from the design handoff (lr-panels.jsx → CoachTab).
 *
 * Real-audio route (E6.4 honesty): the canned coach fixtures fabricate
 * measurements, so the left column becomes the grounded hand-off card to the
 * report's real AI coach, and the right column lists the user's REAL "Added"
 * fixes (localStorage carry-over from the Results page) as per-fix toggles
 * through useFixOverlay. The mock demo route keeps the designed fixtures. */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';

import { Coach } from '../../ui/Coach';
import { Icon } from '../results/Icon';
import { COACH_SUGGESTIONS, PLAN_ITEMS } from './data';
import { applyGate } from './findings/findings-helpers';
import type { FixOverlayHandle } from './findings/useListenFindings';
import { readListenFixes, type ListenFix } from './listenFixes';
import type { ReportRef } from './types';
import type { RackState } from './rackState';
import type { CarryPhase } from './useFixCarryOver';

function SecLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="seclabel">
      <span className="t">{children}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

const SEV_COLOR: Record<string, string> = {
  crit: 'var(--orange)', warn: 'var(--violet)', info: 'var(--cyan)',
};

/** Real-route fixes column: each Added fix is a toggle applying that one fix
 *  to the live rack (uncheck to compare). The overlay instance is the PAGE's
 *  (spec D11) — a second one here would hold its own fix-free baseline and
 *  silently discard whatever the stage board had applied. */
function RealFixes({ versionId, overlay, carryPhase }: {
  versionId: string; overlay: FixOverlayHandle; carryPhase: CarryPhase;
}) {
  const fixes: ListenFix[] = useMemo(() => readListenFixes(versionId), [versionId]);
  const { isApplied, toggle } = overlay;
  // Spec D8: this tab shares the stage board's overlay, so the carried-preset
  // lock must hold here too — same gate, same reason copy.
  const gate = applyGate(carryPhase);
  if (fixes.length === 0) {
    return (
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.55 }}>
        Add fixes on the Results page and they land here — each becomes a toggle
        you can hear against your track.
      </div>
    );
  }
  return (
    <div className="lr-nl">
      {!gate.enabled && gate.reason && (
        <div className="mono" data-testid="coach-fix-gate" style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          {gate.reason}
        </div>
      )}
      {fixes.map((f) => {
        const na = f.notApplicable === true;
        const locked = na || !gate.enabled;
        const on = !na && isApplied(f.fixId);
        const c = SEV_COLOR[f.sev] ?? 'var(--cyan)';
        const modules = [...new Set(f.ops.map((o) => o.type))].join(' · ');
        return (
          <button
            type="button"
            key={f.fixId}
            className={'lr-fix' + (on ? ' done' : '')}
            disabled={locked}
            style={locked ? { opacity: 0.55, cursor: 'default' } : undefined}
            onClick={() => { if (!locked) toggle(f.fixId); }}
          >
            <span className="tg" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>
              {(f.scope || 'fix').toUpperCase()}
            </span>
            <span className="bb">
              <span className="t">{f.title}</span>
              <span className="s">{na ? 'not applicable in the rack — take it back to your DAW' : modules}</span>
            </span>
            {on
              ? <span className="ck"><Icon name="check" size={13} /></span>
              : <span className="ck" style={{ color: 'var(--muted)' }}><Icon name="plus" size={13} /></span>}
          </button>
        );
      })}
    </div>
  );
}

export function CoachTabV2({ rs, real, versionId, reportRef, fixOverlay, carryPhase }: {
  rs: RackState;
  /** Real-audio route ⇒ honest coach hand-off + real Added fixes. */
  real: boolean;
  versionId: string | null;
  reportRef: ReportRef | null;
  /** The page's single fix overlay (spec D11); null on the mock demo route. */
  fixOverlay: FixOverlayHandle | null;
  /** Spec D8 — a carried report preset locks per-fix toggling here too. */
  carryPhase: CarryPhase;
}) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [fixDone, setFixDone] = useState<Record<string, boolean>>({});

  if (real) {
    return (
      <div>
        <p className="tab-intro">
          Fixes you added on the report apply straight into the rack — <b>you hear it before you commit</b>.
        </p>
        <div className="lr-coach2">
          <div>
            <SecLabel>Coach</SecLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="coach-real-honest">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'linear-gradient(135deg, rgba(0,229,176,0.07), rgba(167,139,250,0.05))', border: '1px solid rgba(0,229,176,0.28)' }}>
                <Coach size={40} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Coach</div>
                </div>
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.55 }}>
                The rack coach isn&rsquo;t live yet. Your real AI coach — grounded in this
                track&rsquo;s measured analysis — is on the report.
              </div>
              {reportRef && (
                <Link
                  to="/songs/$songId/results/$jobId"
                  params={{ songId: reportRef.songId, jobId: reportRef.jobId }}
                  className="btn sm"
                  style={{ alignSelf: 'flex-start', color: 'var(--cyan)', borderColor: 'rgba(0,229,176,0.4)' }}
                >
                  Open the report&rsquo;s AI Coach →
                </Link>
              )}
            </div>
          </div>
          <div>
            <SecLabel hint="toggle to compare">Fixes from analysis</SecLabel>
            {versionId && fixOverlay && (
              <RealFixes versionId={versionId} overlay={fixOverlay} carryPhase={carryPhase} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="tab-intro">
        The coach reads this track&rsquo;s analysis live. Each move applies straight into the rack — <b>you hear it before you commit</b>.
      </p>
      <div className="lr-coach2">
        <div>
          <SecLabel hint={COACH_SUGGESTIONS.length - Object.keys(done).length + ' left'}>Coach moves</SecLabel>
          <div className="lr-nl">
            {COACH_SUGGESTIONS.map((c) => (
              <div key={c.id} className="lr-nr" style={{ alignItems: 'center' }}>
                <span className="tm" style={{ color: c.color, width: 68, fontSize: 8.5, fontWeight: 700, letterSpacing: '.07em' }}>{c.persona}</span>
                <span className="tx" style={{ color: 'var(--text)' }}>{c.title}</span>
                <span className="tm lr-move" style={{ width: 'auto', color: 'var(--muted)' }}>{c.move}</span>
                <button
                  type="button"
                  className={done[c.id] ? 'btn sm' : 'btn sm primary'}
                  onClick={() => {
                    rs.applyCoach(c.apply);
                    setDone((d) => ({ ...d, [c.id]: true }));
                    toast.success(c.title, { description: c.move });
                  }}
                >
                  {done[c.id] ? <><Icon name="check" size={13} />Applied</> : 'Apply'}
                </button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SecLabel hint={PLAN_ITEMS.length - Object.keys(fixDone).length + ' left'}>Fixes from analysis</SecLabel>
          <div className="lr-nl">
            {PLAN_ITEMS.map((f) => (
              <button
                type="button"
                key={f.id}
                className={'lr-fix' + (fixDone[f.id] ? ' done' : '')}
                onClick={() => {
                  rs.applyCoach(f.apply);
                  setFixDone((d) => ({ ...d, [f.id]: true }));
                  toast.success(f.title, { description: f.fix });
                }}
              >
                <span className="tg" style={{ color: f.color, background: `color-mix(in srgb, ${f.color} 12%, transparent)` }}>{f.tag}</span>
                <span className="bb"><span className="t">{f.title}</span><span className="s">{f.fix}</span></span>
                {fixDone[f.id]
                  ? <span className="ck"><Icon name="check" size={13} /></span>
                  : <span className="ck" style={{ color: 'var(--muted)' }}><Icon name="plus" size={13} /></span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

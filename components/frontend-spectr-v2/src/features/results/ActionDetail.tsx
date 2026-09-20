import { useEffect, useMemo, useState } from 'react';

import type { VerdictDto } from '../../api/types';
import type { Move } from './move-model';
import { Icon } from './Icon';
import { CoachStatic } from '../../ui/Coach';
import { severityColor } from './helpers/severity';
import { parseEvidenceRows } from './evidence-model';
import { Glossify } from './glossary';
import { EvRows, GroupChip, SourceTag } from './FixBoardChips';
import { OpRack } from './OpRack';
import {
  GROUP_TIP,
  groupForVerdict,
  sevTitle,
  specName,
  type FixBoardSurface,
  type SeekAffordance,
} from './fix-board-helpers';

// Actions-mode detail panel (v4): fix-first. Sub-tabs Applicable Fix (op rack +
// Listen-queue toggle — localStorage ONLY, the 78-fixes footgun) | Quick DAW
// Instructions. Mark applied + Rate this Suggestion write server state.

interface ActionDetailProps {
  f: VerdictDto | null;
  move: Move | null;
  added: boolean;
  onToggleCommit: (move: Move) => void;
  onShowFinding: (verdictId: string) => void;
  onAskCoach?: ((v: VerdictDto) => void) | undefined;
  onMarkApplied?: ((v: VerdictDto) => void) | undefined;
  onRate?: ((v: VerdictDto, rating: number, notes: string) => void) | undefined;
  onShowSpectrum?: ((range: [number, number]) => void) | undefined;
  surface?: FixBoardSurface | undefined;
  seek?: SeekAffordance | undefined;
}

export function ActionDetail({
  f,
  move,
  added,
  onToggleCommit,
  onShowFinding,
  onAskCoach,
  onMarkApplied,
  onRate,
  onShowSpectrum,
  surface = 'report',
  seek,
}: ActionDetailProps) {
  const [fixTab, setFixTab] = useState<'fix' | 'daw'>('fix');
  const [rateOpen, setRateOpen] = useState(false);
  const evRows = useMemo(() => (f ? parseEvidenceRows(f.evidence) : []), [f]);
  useEffect(() => {
    setFixTab('fix');
    setRateOpen(false);
  }, [f?.id]);

  if (!f) {
    return (
      <div className="fb-detail empty">
        <Icon name="info" size={18} />
        <span>Select an action to see the fix detail.</span>
      </div>
    );
  }

  const group = groupForVerdict(f);
  const spec = specName(f);
  const applied = f.userState.applied;
  const rated = f.userState.feedback != null;
  const isMaster = move ? /^master/i.test(move.scope) : true;
  const expectedOutcome = f.fix?.expected_outcome?.trim();
  // Spec D2/D9 — the Listen surface never writes server state, and must not
  // tell the reader to go to the page they are already standing on.
  const listen = surface === 'listen';
  const seekLabel = seek ? seek.label(f) : null;

  return (
    <div className="fb-detail" style={{ ['--sev' as string]: severityColor(f.severity) }}>
      <div className="fbd-scroll">
        <div className="fbd-toplab">{move ? 'Fix' : 'Note'}</div>
        <div className="fbd-meta">
          <span className="fbd-sev">{sevTitle(f.severity)}</span>
          <GroupChip group={group} />
          <span className="addr">
            Addresses Finding:{' '}
            <button
              type="button"
              className="addr-lnk"
              onClick={() => onShowFinding(f.id)}
              title="Open on the Findings tab"
            >
              {f.headline}
            </button>
          </span>
          <SourceTag v={f} spec={spec !== group ? spec : null} />
        </div>

        {seek && seekLabel && (
          <button
            type="button"
            className="fbd-seek"
            title="Jump to this moment in the track"
            onClick={() => seek.go(f)}
          >
            <Icon name="play" size={11} />
            {seekLabel}
          </button>
        )}

        {move ? (
          <div className="fbd-fix">
            <div className="fbd-fixhd">
              <span className="fx-lab">The fix</span>
              <span className="fbd-spacer" />
            </div>
            <div className="fbd-fixsub">
              <span className="fx-lab2">Suggested fix</span>
              <span className="fx-conf">
                <span className="cv">{Math.round(move.confidence * 100)}%</span> conf
              </span>
              <span className="fx-scope mono">{move.hasParams ? move.scope : 'directional'}</span>
            </div>
            <div className="fbd-fixtitle">{move.title}</div>
            <div className={`directive${move.hasParams ? '' : ' directional'}`}>
              <span className="arrow">→</span>
              <div className="d-text">
                <Glossify text={move.directive} />
              </div>
            </div>

            <div className="fbd-subtabs">
              <button
                type="button"
                className={fixTab === 'fix' ? 'on' : ''}
                onClick={() => setFixTab('fix')}
              >
                Applicable fix
              </button>
              <button
                type="button"
                className={fixTab === 'daw' ? 'on' : ''}
                onClick={() => setFixTab('daw')}
              >
                Quick DAW Instructions
              </button>
            </div>

            {fixTab === 'fix' ? (
              <div className="fbd-grid">
                {move.ops.length > 0 ? (
                  <div className="fbd-rack">
                    <div className="fbd-rackhd-row">
                      <span className="fbd-rackhd">Suggested fix</span>
                      {isMaster ? (
                        <span className="scopechip gloss">
                          Master
                          <span className="gtip">
                            {listen
                              ? 'Applies to the whole master bus — the rack reproduces it exactly.'
                              : 'Applies to the whole master bus — the Listen rack reproduces it exactly.'}
                          </span>
                        </span>
                      ) : (
                        <span className="scopechip dev gloss">
                          Device: {move.scope}
                          <span className="gtip">
                            This fix targets {move.scope}.{' '}
                            {listen
                              ? 'Listen plays the bounced mix, so applying it auditions a master-bus approximation'
                              : 'Listen plays the bounced mix, so adding it auditions a master-bus approximation'}
                            {' '}— the exact per-device move is in your DAW Plan.
                          </span>
                        </span>
                      )}
                      <span className="fbd-footnote">
                        {added ? (
                          <>
                            <span className="dot on" />
                            {listen ? 'Applied to the rack' : 'Queued for Listen'}
                            {!isMaster && ' · approximation'}
                          </>
                        ) : listen ? (
                          isMaster
                            ? 'Apply it to hear it on the rack now'
                            : 'Apply it to preview an approximation'
                        ) : isMaster ? (
                          'Add to apply live on the Listen page'
                        ) : (
                          'Add to preview an approximation on Listen'
                        )}
                      </span>
                      <button
                        type="button"
                        className={`rack-toggle sm${added ? ' on' : ''}`}
                        onClick={() => onToggleCommit(move)}
                      >
                        <Icon name={added ? 'check' : 'plus'} size={12} />
                        {listen
                          ? added ? 'Applied' : 'Apply live'
                          : added ? 'Added' : 'Add to fix rack'}
                      </button>
                    </div>
                    <OpRack ops={move.ops} />
                  </div>
                ) : (
                  <div className="na">
                    <Icon name="info" size={13} />
                    Directional advice — no device chain to add. Use the DAW instructions.
                  </div>
                )}
              </div>
            ) : (
              <div className="fbd-dawtab dark">
                <div className="fbd-abhint">
                  <span className="oh">
                    <Icon name="folder" size={12} />
                    In your Project
                  </span>
                  {move.steps.length > 0 ? (
                    <ol className="fbd-steps">
                      {move.steps.map((st, i) => (
                        <li key={i} className="mono">
                          <mark className="devhl">{st.where}</mark>
                          {st.detail ? `: ${st.detail}` : ''}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mono">{move.directive}</p>
                  )}
                </div>
                <div className="fbd-outcome listen">
                  <span className="oh">
                    <Icon name="wave" size={12} />
                    What to listen for
                  </span>
                  <p>
                    <Glossify
                      text={
                        expectedOutcome ||
                        'Toggle the change on and off while looping the affected section — keep it only if the fix reads as an improvement at matched volume.'
                      }
                    />
                  </p>
                </div>
              </div>
            )}

            {evRows.length > 0 && (
              <div className="fbd-data open">
                <div className="fbd-datahd static">
                  <span className="lab">The data</span>
                </div>
                <div className="fbd-datachart fade-up">
                  <EvRows rows={evRows} onShowSpectrum={onShowSpectrum} />
                </div>
              </div>
            )}

            {expectedOutcome && (
              <div className="fbd-outcome">
                <span className="oh">
                  <Icon name="sparkle" size={12} />
                  Expected outcome
                </span>
                <p>
                  <Glossify text={expectedOutcome} />
                </p>
              </div>
            )}

            {!listen && (
              <>
                <div className="fbd-fb">
                  {applied ? (
                    <span className="fb-done">
                      <Icon name="check" size={13} />
                      Marked applied — re-analyze to verify the result
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="fbd-ask"
                      onClick={() => onMarkApplied?.(f)}
                      title="Record that you made this move in your DAW"
                    >
                      <Icon name="check" size={13} />
                      Mark applied
                    </button>
                  )}
                  {rated ? (
                    <span className="fb-done">
                      <Icon name="check" size={13} />
                      Rating submitted — thanks, it tunes future fixes
                    </span>
                  ) : (
                    <span className="fb-rate">
                      <button type="button" className="fbd-ask" onClick={() => setRateOpen(true)}>
                        Rate this Suggestion
                      </button>
                      <button
                        type="button"
                        className="fb-thumb"
                        onClick={() => setRateOpen(true)}
                        title="Helpful — rate this suggestion"
                      >
                        <Icon name="thumbup" size={13} />
                      </button>
                      <button
                        type="button"
                        className="fb-thumb dn"
                        onClick={() => setRateOpen(true)}
                        title="Not helpful — rate this suggestion"
                      >
                        <Icon name="thumbdown" size={13} />
                      </button>
                    </span>
                  )}
                </div>
                {rateOpen && (
                  <RatingModal
                    f={f}
                    move={move}
                    onClose={() => setRateOpen(false)}
                    onSubmit={(rating, notes) => {
                      setRateOpen(false);
                      onRate?.(f, rating, notes);
                    }}
                  />
                )}
              </>
            )}
          </div>
        ) : f.severity === 'win' ? (
          <div className="fbd-nofix">
            <Icon name="check" size={14} />A win — nothing to change here.
          </div>
        ) : (
          <div className="fbd-fix">
            <div className="fbd-fixhd">
              <span className="fx-lab note">The note</span>
              <span className="fbd-spacer" />
            </div>
            <div className="fbd-fixsub">
              <span className="fx-lab2">Manual move — no one-click fix</span>
            </div>
            <div className="fbd-fixtitle">{f.headline}</div>
            <p className="fbd-sum" style={{ marginTop: 6 }}>
              <Glossify text={f.summary ?? f.body} />
            </p>
            <div className="fbd-tip">
              <span className="th">
                <Icon name="sparkle" size={12} />
                General tip
              </span>
              <p>
                <Glossify text={GROUP_TIP[group]} />
              </p>
              <p className="sub mono">
                {listen
                  ? 'This is a DAW move — apply it in your project; there is nothing to put on the rack.'
                  : 'This is a DAW move — apply it in your project; nothing gets queued to Listen.'}
              </p>
            </div>
            <div className="fbd-cta">
              {surface === 'report' && onAskCoach && (
                <button type="button" className="fbd-ask" onClick={() => onAskCoach(f)}>
                  <span className="coach-ic">
                    <CoachStatic size={17} />
                  </span>
                  Ask the coach about this
                </button>
              )}
              <button type="button" className="fbd-ask" onClick={() => onShowFinding(f.id)}>
                View finding
                <Icon name="arrow" size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Rating modal — 1–10 + notes; the finding and fix ride along. Server enum
// is helpful|wrong (≥6 → helpful); the rich payload stays client-side under
// localStorage until a backend endpoint exists (v4 stub policy). ──
function RatingModal({
  f,
  move,
  onClose,
  onSubmit,
}: {
  f: VerdictDto;
  move: Move;
  onClose: () => void;
  onSubmit: (rating: number, notes: string) => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal fbm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt">
            <div className="mk">Fix feedback</div>
            <div className="mn">What do you think about this fix?</div>
          </div>
          <button type="button" className="modal-x" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="fbm-ctx">
            <div className="row">
              <span className="k">Finding</span>
              <span className="d" style={{ background: severityColor(f.severity) }} />
              <span className="v">{f.headline}</span>
            </div>
            <div className="row">
              <span className="k">Fix</span>
              <span className="d" style={{ background: 'var(--accent)' }} />
              <span className="v">{move.title}</span>
            </div>
            <p className="note mono">Both are attached to your feedback automatically.</p>
          </div>
          <div className="fbm-lab">
            Rating<span className="s">1 = not helpful · 10 = nailed it</span>
          </div>
          <div className="fbm-rate">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                type="button"
                key={n}
                className={rating === n ? 'on' : ''}
                onClick={() => setRating(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="fbm-lab">Notes</div>
          <textarea
            className="fbm-notes"
            rows={4}
            placeholder="What worked, what didn’t, what you’d change…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="fbm-foot">
            <button type="button" className="fbd-ask" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="fbd-goact"
              disabled={rating == null}
              onClick={() => rating != null && onSubmit(rating, notes)}
            >
              Submit feedback
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

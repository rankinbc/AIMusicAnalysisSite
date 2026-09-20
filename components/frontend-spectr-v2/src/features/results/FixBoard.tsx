import { useEffect, useMemo, useState } from 'react';

import type { VerdictDto } from '../../api/types';
import { Icon } from './Icon';
import { CoachStatic } from '../../ui/Coach';
import { SEVERITY_RANK, severityColor } from './helpers/severity';
import type { Move } from './move-model';
import { groupProblems, type ProblemNode } from './problems-helpers';
import {
  deviceOf,
  EMPTY_FILTERS,
  GROUP_COLOR,
  groupForVerdict,
  SEV_ORDER,
  type FilterState,
  type FixBoardSurface,
  type SeekAffordance,
  type Sev,
} from './fix-board-helpers';
import { FixBoardFilters } from './FixBoardFilters';
import { FindingDetail } from './FindingDetail';
import { ActionDetail } from './ActionDetail';

// v4 dual-mode master-detail board (prototype `.fixboard`):
//   mode="findings" — diagnosis-first. Severity-grouped finding list with
//     per-row ignore / ask-the-coach / checkbox; detail = FindingDetail.
//   mode="actions"  — fix-first. List rows are FIX TITLES (plus checked
//     fix-less findings as notes); detail = ActionDetail with sub-tabs.
// The Listen queue (checkbox/add toggles) is localStorage-only BY DESIGN —
// only Mark-applied/ignore/rate write server state (78-fixes footgun).

export type FixBoardMode = 'findings' | 'actions';

interface FixBoardProps {
  mode: FixBoardMode;
  verdicts: VerdictDto[];
  moves: Move[];
  committedIds: ReadonlySet<string>;
  onToggleCommit: (move: Move) => void;
  /** Fix-less findings the user checked — they surface on Actions as notes. */
  checkedNoteIds: ReadonlySet<string>;
  onToggleNote: (verdictId: string) => void;
  /** Cross-tab deep-link target (verdict id); consumed once landed. */
  focusId: string | null;
  onConsumeFocus: () => void;
  onShowFix: (verdictId: string) => void;
  onShowFinding: (verdictId: string) => void;
  onAskCoach?: ((v: VerdictDto) => void) | undefined;
  /** Server dismiss. Never supplied on the Listen surface (spec D2). */
  onIgnore?: ((v: VerdictDto) => void) | undefined;
  onMarkApplied?: ((v: VerdictDto) => void) | undefined;
  onRate?: ((v: VerdictDto, rating: number, notes: string) => void) | undefined;
  onShowSpectrum?: ((range: [number, number]) => void) | undefined;
  /** Which page this board is on. Default 'report' — everything below that is
   *  conditional on it is a server write or report-only geography (spec D9). */
  surface?: FixBoardSurface | undefined;
  seek?: SeekAffordance | undefined;
}

interface Row {
  v: VerdictDto;
  move: Move | null;
  isNote: boolean;
  depth: number;
}

export function FixBoard({
  mode,
  verdicts,
  moves,
  committedIds,
  onToggleCommit,
  checkedNoteIds,
  onToggleNote,
  focusId,
  onConsumeFocus,
  onShowFix,
  onShowFinding,
  onAskCoach,
  onIgnore,
  onMarkApplied,
  onRate,
  onShowSpectrum,
  surface = 'report',
  seek,
}: FixBoardProps) {
  const findingsMode = mode === 'findings';
  const findings = useMemo(
    () => verdicts.filter((v) => v.headline !== 'Specialist failed'),
    [verdicts],
  );
  const moveFor = useMemo(() => {
    const byId = new Map(moves.filter((m) => m.verdictId).map((m) => [m.verdictId as string, m]));
    return (v: VerdictDto): Move | null => (v.fixable ? (byId.get(v.id) ?? null) : null);
  }, [moves]);

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selId, setSelId] = useState<string | null>(null);

  // refines-threading: children nest under their parent (revived groupProblems).
  const nodes: ProblemNode[] = useMemo(
    () => groupProblems(findings).flatMap((g) => g.nodes),
    [findings],
  );

  // Base row list per mode (pre-filter).
  const baseRows: Row[] = useMemo(() => {
    if (findingsMode) {
      return nodes.flatMap((n) => [
        { v: n.problem, move: moveFor(n.problem), isNote: false, depth: 0 },
        ...n.children.map((c) => ({ v: c, move: moveFor(c), isNote: false, depth: 1 })),
      ]);
    }
    // Actions: findings with a live move (dismissed drop out of buildMoves),
    // plus checked fix-less findings as notes.
    return findings
      .filter((v) => !v.userState.dismissed)
      .map((v) => ({ v, move: moveFor(v), isNote: false, depth: 0 }))
      .filter((r) => r.move != null || checkedNoteIds.has(r.v.id))
      .map((r) => (r.move ? r : { ...r, isNote: true }))
      .sort(
        (a, b) =>
          (SEVERITY_RANK[b.v.severity as Sev] ?? 0) - (SEVERITY_RANK[a.v.severity as Sev] ?? 0) ||
          b.v.priorityScore - a.v.priorityScore,
      );
  }, [findingsMode, nodes, findings, moveFor, checkedNoteIds]);

  // Filters (top-level rows only; nested children follow their parent).
  const rows = useMemo(() => {
    const pass = (r: Row): boolean => {
      if (filters.fixableOnly && !r.move) return false;
      if (filters.groups.size > 0 && !filters.groups.has(groupForVerdict(r.v))) return false;
      if (filters.devices.size > 0) {
        const d = r.move ? deviceOf(r.move.scope) : null;
        if (!d || !filters.devices.has(d)) return false;
      }
      if (
        filters.minPriority > 0 &&
        r.v.severity !== 'win' &&
        r.v.priorityScore < filters.minPriority
      )
        return false;
      return true;
    };
    const out: Row[] = [];
    for (let i = 0; i < baseRows.length; i++) {
      const r = baseRows[i]!;
      if (r.depth > 0) continue; // children ride with their parent
      if (!pass(r)) continue;
      out.push(r);
      for (let j = i + 1; j < baseRows.length && baseRows[j]!.depth > 0; j++) {
        out.push(baseRows[j]!);
      }
    }
    return out;
  }, [baseRows, filters]);

  // Keep a valid selection as the list changes.
  useEffect(() => {
    if (rows.length === 0) {
      setSelId(null);
      return;
    }
    if (!rows.some((r) => r.v.id === selId)) setSelId(rows[0]?.v.id ?? null);
  }, [rows, selId]);

  // External focus (deep-link from the other tab): clear filters, select.
  useEffect(() => {
    if (!focusId) return;
    if (findings.some((f) => f.id === focusId)) {
      setFilters(EMPTY_FILTERS);
      setSelId(focusId);
    }
    onConsumeFocus();
  }, [focusId, findings, onConsumeFocus]);

  const fixableCount = findings.filter((f) => moveFor(f) != null).length;
  const sel = findings.find((f) => f.id === selId) ?? null;
  const selMove = sel ? moveFor(sel) : null;

  if (findings.length === 0) {
    return (
      <div className="fb-empty">
        <div className="es-ic">
          <Icon name="check" size={20} />
        </div>
        <div className="es-t">No issues found</div>
        <div className="es-s">
          Nothing surfaced on this track. Ask the Coach if you want a second opinion.
        </div>
      </div>
    );
  }

  const groupsPresent = [...new Set(findings.map(groupForVerdict))].map((g) => ({
    name: g,
    count: findings.filter((f) => groupForVerdict(f) === g).length,
  }));
  const devicesPresent = [
    ...new Set(
      findings
        .map((f) => {
          const m = moveFor(f);
          return m ? deviceOf(m.scope) : null;
        })
        .filter((d): d is string => d != null),
    ),
  ]
    .sort((a, b) => (a === 'Master' ? -1 : b === 'Master' ? 1 : a.localeCompare(b)))
    .map((d) => ({
      name: d,
      count: findings.filter((f) => {
        const m = moveFor(f);
        return m != null && deviceOf(m.scope) === d;
      }).length,
    }));
  const maxPriority = Math.max(0, ...findings.map((f) => f.priorityScore));

  const allSelected =
    fixableCount > 0 &&
    findings.every((f) => {
      const m = moveFor(f);
      return !m || committedIds.has(m.id);
    });
  const onSelectAll = () => {
    const target = !allSelected;
    for (const f of findings) {
      const m = moveFor(f);
      if (!m) continue;
      const isOn = committedIds.has(m.id);
      if (target && !isOn) onToggleCommit(m);
      if (!target && isOn) onToggleCommit(m);
    }
  };

  return (
    <div className="fixboard">
      <div className={`fb-list${findingsMode ? ' wide' : ''}`}>
        <div className="fb-lh">
          <span className="t">{findingsMode ? 'Findings' : 'Actions'}</span>
          <div className="fb-filters">
            {!findingsMode && (
              <button type="button" className="fpill selall" onClick={onSelectAll}>
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            )}
            <FixBoardFilters
              filters={filters}
              onChange={setFilters}
              totalCount={findings.length}
              fixableCount={fixableCount}
              groupsPresent={groupsPresent}
              devicesPresent={devicesPresent}
              maxPriority={maxPriority}
            />
          </div>
        </div>
        <div className="fb-scroll">
          {rows.length === 0 ? (
            <div className="na" style={{ margin: '8px 4px' }}>
              <Icon name="info" size={13} />
              Nothing matches this filter.
            </div>
          ) : (
            SEV_ORDER.map((sev) => {
              const grp = rows.filter((r) => r.v.severity === sev && r.depth === 0);
              if (grp.length === 0) return null;
              return (
                <div key={sev}>
                  <div className="fb-sevhd" style={{ ['--sev' as string]: severityColor(sev) }}>
                    <span className="d" />
                    {sev === 'win' ? 'wins' : sev}
                    <span className="c">{grp.length}</span>
                  </div>
                  {grp.map((r) => {
                    const children = findingsMode
                      ? rows.filter(
                          (c) =>
                            c.depth > 0 &&
                            c.v.refines != null &&
                            c.v.refines === r.v.problemId,
                        )
                      : [];
                    return (
                      <div key={r.v.id}>
                        <BoardRow
                          row={r}
                          mode={mode}
                          surface={surface}
                          selected={r.v.id === selId}
                          committed={r.move != null && committedIds.has(r.move.id)}
                          noted={checkedNoteIds.has(r.v.id)}
                          onSelect={() => setSelId(r.v.id)}
                          onToggleCommit={onToggleCommit}
                          onToggleNote={onToggleNote}
                          onAskCoach={onAskCoach}
                          onIgnore={onIgnore}
                        />
                        {children.map((c) => (
                          <BoardRow
                            key={c.v.id}
                            row={c}
                            mode={mode}
                            surface={surface}
                            selected={c.v.id === selId}
                            committed={c.move != null && committedIds.has(c.move.id)}
                            noted={checkedNoteIds.has(c.v.id)}
                            onSelect={() => setSelId(c.v.id)}
                            onToggleCommit={onToggleCommit}
                            onToggleNote={onToggleNote}
                            onAskCoach={onAskCoach}
                            onIgnore={onIgnore}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      {findingsMode ? (
        <FindingDetail
          f={sel}
          move={selMove}
          onAskCoach={onAskCoach}
          onShowFix={onShowFix}
          onShowSpectrum={onShowSpectrum}
          surface={surface}
          seek={seek}
        />
      ) : (
        <ActionDetail
          f={sel}
          move={selMove}
          added={selMove != null && committedIds.has(selMove.id)}
          onToggleCommit={onToggleCommit}
          onShowFinding={onShowFinding}
          onAskCoach={onAskCoach}
          onMarkApplied={onMarkApplied}
          onRate={onRate}
          onShowSpectrum={onShowSpectrum}
          surface={surface}
          seek={seek}
        />
      )}
    </div>
  );
}

function BoardRow({
  row,
  mode,
  surface,
  selected,
  committed,
  noted,
  onSelect,
  onToggleCommit,
  onToggleNote,
  onAskCoach,
  onIgnore,
}: {
  row: Row;
  mode: FixBoardMode;
  surface: FixBoardSurface;
  selected: boolean;
  committed: boolean;
  noted: boolean;
  onSelect: () => void;
  onToggleCommit: (move: Move) => void;
  onToggleNote: (verdictId: string) => void;
  onAskCoach?: ((v: VerdictDto) => void) | undefined;
  onIgnore?: ((v: VerdictDto) => void) | undefined;
}) {
  const { v, move, isNote, depth } = row;
  const findingsMode = mode === 'findings';
  const dismissed = v.userState.dismissed;
  const group = groupForVerdict(v);
  return (
    <button
      type="button"
      className={
        `fb-row${selected ? ' on' : ''}${committed ? ' added' : ''}` +
        `${dismissed ? ' ignored' : ''}${depth > 0 ? ' nested' : ''}`
      }
      style={{ ['--sev' as string]: severityColor(v.severity) }}
      onClick={onSelect}
    >
      {depth > 0 && <span className="fr-branch" aria-hidden>└</span>}
      <span className="fr-dot" />
      <span className="fr-b">
        <span className="fr-head">{findingsMode || !move ? v.headline : move.title}</span>
        <span className="fr-meta mono">
          <span className="fr-grp" style={{ color: GROUP_COLOR[group] }}>
            {group}
          </span>
          {move && move.hasParams ? ` · ${move.scope}` : ''}
          {!move ? (findingsMode ? ' · observation' : ' · note · manual move') : ''}
          {dismissed ? ' · ignored' : ''}
        </span>
      </span>
      {findingsMode ? (
        <span className="fr-acts" onClick={(e) => e.stopPropagation()}>
          {move ? (
            <span
              className={`fr-ckbox gloss${committed ? ' on' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onToggleCommit(move)}
              onKeyDown={(e) => e.key === 'Enter' && onToggleCommit(move)}
            >
              <Icon name={committed ? 'check' : 'plus'} size={11} />
              <span className="gtip">
                {surface === 'listen'
                  ? 'A suggested fix is available — check to hear it'
                  : 'A suggested fix is available — check to queue it'}
              </span>
            </span>
          ) : surface === 'report' ? (
            <span
              className={`fr-ckbox off gloss${noted ? ' on' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onToggleNote(v.id)}
              onKeyDown={(e) => e.key === 'Enter' && onToggleNote(v.id)}
            >
              {noted && <Icon name="check" size={11} />}
              <span className="gtip">No one-click fix — check to add as a note to Actions</span>
            </span>
          ) : null}
          {surface === 'report' && onAskCoach && (
            <span
              className="fr-ic gloss"
              role="button"
              tabIndex={0}
              onClick={() => onAskCoach(v)}
              onKeyDown={(e) => e.key === 'Enter' && onAskCoach(v)}
            >
              <CoachStatic size={15} />
              <span className="gtip">Ask the Coach about this</span>
            </span>
          )}
          {surface === 'report' && !dismissed && onIgnore && (
            <span
              className="fr-ic gloss"
              role="button"
              tabIndex={0}
              onClick={() => onIgnore(v)}
              onKeyDown={(e) => e.key === 'Enter' && onIgnore(v)}
            >
              <Icon name="eyeoff" size={13} />
              <span className="gtip">Ignore this finding — hides its action too</span>
            </span>
          )}
        </span>
      ) : move ? (
        <span
          className={`fr-add${committed ? ' on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCommit(move);
          }}
          title={
            committed
              ? surface === 'listen' ? 'Remove from the rack' : 'Remove from Listen queue'
              : surface === 'listen' ? 'Apply to the rack' : 'Queue this fix'
          }
        >
          <Icon name={committed ? 'check' : 'plus'} size={12} />
        </span>
      ) : isNote ? (
        <span
          className={`fr-add note${noted ? ' on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleNote(v.id);
          }}
          title={noted ? 'Unmark this note' : 'Mark this note to work on in your DAW'}
        >
          <Icon name={noted ? 'check' : 'plus'} size={12} />
        </span>
      ) : (
        <span className="fr-obs" title="Observation — no one-click fix" />
      )}
    </button>
  );
}

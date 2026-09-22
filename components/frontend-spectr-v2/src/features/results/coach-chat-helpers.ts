// Story 1.8 / code-review P20 — pure helpers extracted from CoachChat.tsx
// so the component file stays under the CLAUDE.md ~500-line ceiling and
// each helper is independently unit-testable.

import type { CoachConversationDto, CoachEvidenceDto } from '../../api/types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  evidence?: CoachEvidenceDto[] | null;
  refused?: boolean;
  /** Refusal reason code (from the worker — "missing_data" / "out_of_scope"
   *  / "injection_attempt" / "coach_offline"). Drives the unlock chip. */
  refusalReason?: string | null;
  /** Set true once the assistant turn has received its terminal frame
   *  (done / refusal / error / aborted-with-partial-text). */
  finalized?: boolean;
  /** teach-mode-coach (+ adhoc-concise): "teach" turns are badged in the
   *  transcript ("concise" gets no badge). Set optimistically at send time;
   *  survives reload via CoachMessageDto.mode. */
  mode?: 'qa' | 'teach' | 'concise';
  /** Task G6 — true for the once-per-conversation coach brief. */
  isBrief?: boolean;
  /** Task G6 — non-null only for a guest's completed brief; render verbatim
   *  (never hard-code) under the bubble alongside the account-creation CTA. */
  closingLine?: string | null;
}

export interface UnlockAction {
  label: string;
  /** Story 12.5: chips are LIVE — `upgrade` navigates to /pricing;
   *  `add_stems`/`add_reference` open the real upload dialogs via the
   *  ReportView-owned onUnlockAction callback. */
  intent: 'add_stems' | 'add_reference' | 'upgrade';
}

/** Story 12.5: unlock intent → the SongHeader input key whose dialog serves
 *  it. Pure mapping so the chip routing is unit-testable. */
// Task G6 fix round 1 — moved here (was useCoachSession.ts) so both the
// hook's mount-time hydration effect AND useCoachBriefFollow.ts's
// ensure/poll steps share one implementation instead of two copies.
// Adds `isBrief`/`closingLine` so a brief message renders CoachBriefCta
// once it lands.
export function mapMessagesToTurns(messages: CoachConversationDto['messages']): ChatTurn[] {
  return messages.map((m) => {
    const turn: ChatTurn = {
      role: m.role,
      text: m.content,
      finalized: m.status === 'complete' || m.status === 'refused',
    };
    if (m.evidence) turn.evidence = m.evidence;
    if (m.mode === 'teach') turn.mode = 'teach';
    if (m.isBrief) turn.isBrief = true;
    if (typeof m.closingLine === 'string') turn.closingLine = m.closingLine;
    if (m.status === 'refused') {
      turn.refused = true;
      if (m.refusalReason) turn.refusalReason = m.refusalReason;
    }
    return turn;
  });
}

export function unlockIntentToInputKey(
  intent: 'add_stems' | 'add_reference',
): 'stems' | 'reference' {
  return intent === 'add_reference' ? 'reference' : 'stems';
}

/** Resolve a refusal reason code → optional unlock action. Returns null
 *  when the refusal does not map to an actionable unlock (e.g. out-of-scope
 *  refusals just acknowledge and stop). */
export function resolveUnlockAction(
  reason: string | null | undefined,
): UnlockAction | null {
  switch (reason) {
    case 'missing_data':
      // Most common refusal — the worker couldn't ground its answer in
      // the analysis. Stems is the most frequent gap today.
      return { label: 'Add stems', intent: 'add_stems' };
    default:
      return null;
  }
}

export function appendToLastAssistant(
  turns: ChatTurn[],
  delta: string,
): ChatTurn[] {
  if (turns.length === 0) return turns;
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'assistant') return turns;
  const copy = turns.slice(0, -1);
  copy.push({ ...last, text: last.text + delta });
  return copy;
}

export function finalizeLastAssistant(
  turns: ChatTurn[],
  patch: {
    evidence?: CoachEvidenceDto[];
    replaceText?: string;
    refused?: boolean;
    refusalReason?: string | null;
  },
): ChatTurn[] {
  if (turns.length === 0) return turns;
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'assistant') return turns;
  const copy = turns.slice(0, -1);
  const next: ChatTurn = {
    role: last.role,
    text: patch.replaceText !== undefined ? patch.replaceText : last.text,
    evidence: patch.evidence ?? last.evidence ?? null,
    refusalReason: patch.refusalReason ?? last.refusalReason ?? null,
    finalized: true,
  };
  const refused = patch.refused ?? last.refused;
  if (refused !== undefined) next.refused = refused;
  return [...copy, next];
}

// Task G6 fix round 1 (item 1) — `appendToLastAssistant`/`finalizeLastAssistant`
// above are UNCHANGED (byte-identical to before this round) because `send()`
// depends on their exact field set and every existing coach test asserts
// against it. The brief turn (`followMessage()` in useCoachSession.ts) can't
// reuse them as-is: it isn't reliably "the last turn" (a user can start
// chatting while the brief is still pending, appending new turns after it),
// AND finalize must preserve `isBrief`/`closingLine`/`mode` — the two
// functions above deliberately drop everything but the fields `send()`
// needs. These are the general, predicate + full-field-preserving forms,
// used ONLY by `followMessage()`.
export function appendToTurnMatching(
  turns: ChatTurn[],
  predicate: (turn: ChatTurn, index: number) => boolean,
  delta: string,
): ChatTurn[] {
  const idx = turns.findIndex(predicate);
  if (idx === -1) return turns;
  const target = turns[idx];
  if (!target) return turns;
  const copy = turns.slice();
  copy[idx] = { ...target, text: target.text + delta };
  return copy;
}

export function finalizeTurnMatching(
  turns: ChatTurn[],
  predicate: (turn: ChatTurn, index: number) => boolean,
  patch: {
    evidence?: CoachEvidenceDto[];
    replaceText?: string;
    refused?: boolean;
    refusalReason?: string | null;
  },
): ChatTurn[] {
  const idx = turns.findIndex(predicate);
  if (idx === -1) return turns;
  const target = turns[idx];
  if (!target) return turns;
  const next: ChatTurn = {
    ...target,
    text: patch.replaceText !== undefined ? patch.replaceText : target.text,
    evidence: patch.evidence ?? target.evidence ?? null,
    refusalReason: patch.refusalReason ?? target.refusalReason ?? null,
    finalized: true,
  };
  const refused = patch.refused ?? target.refused;
  if (refused !== undefined) next.refused = refused;
  const copy = turns.slice();
  copy[idx] = next;
  return copy;
}

/** Task G6 fix round 1 — matches the once-per-conversation brief's assistant
 *  turn. Safe as a sole identifier: the server enforces at most one brief
 *  per conversation (`ux_coach_messages_brief`). */
export function isBriefTurn(turn: ChatTurn): boolean {
  return turn.role === 'assistant' && turn.isBrief === true;
}

export function trimEmptyPending(turns: ChatTurn[]): ChatTurn[] {
  if (turns.length === 0) return turns;
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'assistant' || last.text.length > 0) return turns;
  return turns.slice(0, -1);
}

/** Story 1.8 / code-review P4 — on user-initiated abort that has already
 *  produced partial text, finalize the turn with a "(stopped)" trailer so
 *  EvidenceChips logic (gated on `finalized`) plays nicely with subsequent
 *  turns. If no text was produced yet, drop the empty pending turn. */
export function finalizeOrTrimOnAbort(turns: ChatTurn[]): ChatTurn[] {
  if (turns.length === 0) return turns;
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'assistant') return turns;
  if (last.text.length === 0) return trimEmptyPending(turns);
  return finalizeLastAssistant(turns, {
    replaceText: last.text + '\n*(stopped)*',
  });
}

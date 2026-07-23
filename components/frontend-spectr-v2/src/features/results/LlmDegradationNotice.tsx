import type { DegradationNoticeDto, DegradationReason } from '../../api/types';
import s from './LlmDegradationNotice.module.css';

// Wave 2 (FR16/UX-DR17) — the "rule-based findings only" notice. Renders when
// the verdicts response carries `degradation` (LLM verdict generation was
// unavailable: budget exhausted, provider outage, or triage failure). SIBLING
// of DegradationBanner (phase-failure semantics, entitlement-free retry) —
// both may render simultaneously; they are independent failures.
//
// Deliberately NO retry affordance: retrying would be wrong for budget /
// circuit-breaker reasons. And never render notice.detail — it is an operator
// string, not user copy.

interface LlmDegradationNoticeProps {
  notice: DegradationNoticeDto;
}

function copyFor(reason: DegradationReason): string {
  switch (reason) {
    case 'tier_budget':
      return "Your plan's AI specialist budget is used up for this month — showing rule-based findings only. Upgrading restores AI verdicts.";
    case 'global_budget':
      return 'AI analysis is over capacity right now — showing rule-based findings only. AI verdicts return automatically.';
    case 'circuit_breaker':
      return 'The AI provider is having trouble — showing rule-based findings only. AI verdicts return automatically once it recovers.';
    case 'triage_failed':
      return 'Specialist routing failed for this analysis — showing rule-based findings only.';
    default:
      // Unknown reason strings pass through the wire verbatim — fail soft.
      return 'AI specialists are unavailable — showing rule-based findings only.';
  }
}

export function LlmDegradationNotice({ notice }: LlmDegradationNoticeProps) {
  return (
    <div
      className={s.banner}
      role="status"
      aria-label="AI verdicts unavailable"
      data-testid="llm-degradation-notice"
    >
      <span className={s.dot} aria-hidden="true" />
      <p className={s.message}>{copyFor(notice.reason)}</p>
    </div>
  );
}

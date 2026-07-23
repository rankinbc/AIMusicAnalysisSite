// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DegradationNoticeDto, DegradationReason } from '../../../api/types';
import { LlmDegradationNotice } from '../LlmDegradationNotice';

afterEach(cleanup);

// Wave 2 (FR16/UX-DR17) — per-reason copy for the "rule-based findings only"
// notice. No retry affordance (budget/breaker retries would be wrong), and
// notice.detail (operator string) must never reach the DOM.

function makeNotice(reason: DegradationReason, detail: string | null = null): DegradationNoticeDto {
  return { reason, detail, occurredAt: '2026-07-23T00:00:00Z' };
}

describe('LlmDegradationNotice (wave 2)', () => {
  it.each([
    ['tier_budget', "Your plan's AI specialist budget"],
    ['global_budget', 'over capacity'],
    ['circuit_breaker', 'The AI provider is having trouble'],
    ['triage_failed', 'Specialist routing failed'],
  ] as const)('renders reason-specific copy for %s', (reason, substring) => {
    render(<LlmDegradationNotice notice={makeNotice(reason)} />);
    const notice = screen.getByTestId('llm-degradation-notice');
    expect(notice.textContent).toContain(substring);
    expect(notice.textContent).toContain('rule-based findings only');
  });

  it('falls back to the default copy for an unknown reason without crashing', () => {
    render(
      <LlmDegradationNotice
        notice={makeNotice('quota_eclipse' as unknown as DegradationReason)}
      />,
    );
    expect(screen.getByTestId('llm-degradation-notice').textContent).toContain(
      'AI specialists are unavailable',
    );
  });

  it('has role="status" and never renders the operator detail string', () => {
    render(
      <LlmDegradationNotice
        notice={makeNotice('tier_budget', 'budget_gateway: tier=free spent=5.01 cap=5.00')}
      />,
    );
    const notice = screen.getByRole('status');
    expect(notice.getAttribute('data-testid')).toBe('llm-degradation-notice');
    expect(notice.textContent).not.toContain('budget_gateway');
  });

  it('offers no retry affordance', () => {
    render(<LlmDegradationNotice notice={makeNotice('circuit_breaker')} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

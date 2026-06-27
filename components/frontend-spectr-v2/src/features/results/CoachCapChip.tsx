import { Pill } from '../../ui/Pill';

// Story 1.9 / UX-DR16 — caps chip. Renders the free-tier specialization of
// the universal grammar `{used} of {limit} {unit} · resets {date}` as
// `{used} of {limit} follow-ups · this analysis`. Story 2.6 will widen this
// to a tier-conditional tail (`· resets {monthlyResetDate}` for Pro).
//
// Amber rule (AC2): the chip turns amber (`Pill tone="orange"`) when
// `limit - used === 1`. Not "at most 20% remaining" — exactly one remaining.
//
// ARIA (Task 4.4 + review-fix P14): the amber color is a color-coded signal;
// the aria-label embeds the visible text verbatim (WCAG 2.5.3 "Label in
// Name") then appends the screen-reader-only `N remaining` cue. We do NOT
// use `role="status"` (review-fix P13) — that would make this a live region
// and announce on every render, including normal mid-conversation updates.
// The chip is a static label; SR users navigating by content read it on
// demand and the `aria-label` carries the same wording sighted users see.

interface CoachCapChipProps {
  used: number;
  limit: number;
}

export function CoachCapChip({ used, limit }: CoachCapChipProps) {
  // Unlimited tiers report an int-max limit — render "unlimited" rather than
  // the raw 2147483647.
  const unlimited = !Number.isFinite(limit) || limit >= 1_000_000;
  const remaining = Math.max(0, limit - used);
  const tone = !unlimited && remaining === 1 ? 'orange' : 'default';
  const visibleText = unlimited
    ? 'unlimited follow-ups'
    : `${used} of ${limit} follow-ups · this analysis`;
  const ariaLabel = unlimited ? visibleText : `${visibleText}, ${remaining} remaining`;

  return (
    <span aria-label={ariaLabel}>
      <Pill tone={tone}>{visibleText}</Pill>
    </span>
  );
}

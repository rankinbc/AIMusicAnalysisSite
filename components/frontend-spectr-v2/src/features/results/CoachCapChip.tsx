import { Pill } from '../../ui/Pill';

// Story 1.9 / UX-DR16 — caps chip. Renders the free-tier specialization of
// the universal grammar `{used} of {limit} {unit} · resets {date}` as
// `{used} of {limit} follow-ups · this analysis`. Story 2.6 will widen this
// to a tier-conditional tail (`· resets {monthlyResetDate}` for Pro).
//
// Amber rule (AC2): the chip turns amber (`Pill tone="orange"`) when
// `limit - used === 1`. Not "at most 20% remaining" — exactly one remaining.
//
// ARIA (Task 4.4): the amber color is a color-coded signal; the aria-label
// gives screen-reader users the same `N remaining` cue sighted users get
// from the visible color change.

interface CoachCapChipProps {
  used: number;
  limit: number;
}

export function CoachCapChip({ used, limit }: CoachCapChipProps) {
  const remaining = Math.max(0, limit - used);
  const tone = remaining === 1 ? 'orange' : 'default';
  const ariaLabel =
    `Coach follow-ups: ${used} used of ${limit} available, ${remaining} remaining`;

  return (
    <span aria-label={ariaLabel} role="status">
      <Pill tone={tone}>
        {used} of {limit} follow-ups · this analysis
      </Pill>
    </span>
  );
}

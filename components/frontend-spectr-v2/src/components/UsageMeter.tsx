import s from './UsageMeter.module.css';

// Story 2.8 / UX-DR31 — passive usage meter. Two variants:
//   nav  — compact chip for the avatar/account menu (informational, never
//          opens a modal — AC4 "no surprise modals").
//   page — fuller meter with a track/fill bar for the usage page summary.
// Pure presentational: the parent passes used/limit; the meter does no fetching
// and no arithmetic beyond deriving the fill %. `limit === null` = unlimited.

interface UsageMeterProps {
  used: number;
  limit: number | null;
  label?: string;
  variant?: 'nav' | 'page';
  /** Override the computed text (e.g. a credit balance). Suppresses the bar —
   *  use when the metric isn't a simple used/limit ratio (credits tier). */
  valueText?: string;
}

export function UsageMeter({
  used,
  limit,
  label,
  variant = 'page',
  valueText: valueTextOverride,
}: UsageMeterProps) {
  const unlimited = limit === null;
  const remaining = unlimited ? Infinity : Math.max(0, limit - used);
  const near = !valueTextOverride && !unlimited && remaining <= 1;
  const pct =
    unlimited || limit === 0 ? 0 : Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
  const valueText = valueTextOverride ?? (unlimited ? 'Unlimited' : `${used} of ${limit}`);
  const showBar = !valueTextOverride && !unlimited;
  const ariaLabel = label ? `${label}: ${valueText}` : valueText;

  return (
    <div
      className={`${s.meter} ${s[variant]}`}
      data-near={near || undefined}
      role="group"
      aria-label={ariaLabel}
    >
      <div className={s.row}>
        {label && <span className={`label ${s.label}`}>{label}</span>}
        <span className={`mono ${s.value}`}>{valueText}</span>
      </div>
      {showBar && (
        <span className={s.track} aria-hidden="true">
          <span className={s.fill} style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}

import type { CoachEvidenceDto } from '../../api/types';
import { Pill } from '../../ui/Pill';
import { scrollAndHighlight } from './evidence-chips-helpers';

// Story 1.8 / Task 5 / AC3 — render the worker-emitted `evidence` array
// (terminal `done` SSE frame) as a row of tappable Pill chips. Each chip
// announces its citation via aria-label and, if a `path` is set, scrolls
// the matching report panel into view + transient-highlights it.
//
// `path` format from the worker (see components/worker/app/coach_actor.py
// + coach_lib/context.py): a verdict id (`verdict-<uuid>`), a tab key
// ("spectrum" | "reference" | "arrangement" | "analysis"), or a generic
// DOM id. We pass `path` to `scrollAndHighlight` which resolves a DOM
// element by id and triggers the highlight class.

interface EvidenceChipsProps {
  evidence: CoachEvidenceDto[] | null | undefined;
  className?: string;
}

export function EvidenceChips({ evidence, className }: EvidenceChipsProps) {
  if (!evidence || evidence.length === 0) return null;

  return (
    <div
      className={className}
      role="group"
      aria-label="Evidence cited by the coach"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}
    >
      {evidence.map((item, idx) => {
        const ariaLabel = `Cite: ${item.label}${item.path ? `, scroll to source` : ''}`;
        if (!item.path) {
          // Static citation chip (no scroll target).
          return (
            <Pill
              key={`${item.label}-${idx}`}
              tone="cyan"
              title={item.label}
              {...{ 'aria-label': ariaLabel }}
            >
              {item.label}
            </Pill>
          );
        }
        // Clickable chip — wrap the Pill in a button so click + keyboard
        // interaction work without redefining Pill's API.
        return (
          <button
            key={`${item.label}-${idx}`}
            type="button"
            onClick={() => scrollAndHighlight(item.path)}
            aria-label={ariaLabel}
            title={item.label}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              font: 'inherit',
              color: 'inherit',
            }}
          >
            <Pill tone="cyan">{item.label}</Pill>
          </button>
        );
      })}
    </div>
  );
}

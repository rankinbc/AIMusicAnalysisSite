/* SPECTR · Story 11.12 — the fork-to-suggest mode chip. Renders above the rack
 * while a reviewer is shaping a draft. Kept as its own component so the AC1/7/8
 * states (nudge copy, A/B labels, Submit/Discard) are static-render testable
 * without mounting the page. */

export interface SuggestModeChipProps {
  playing: boolean;
  /** Which side is audible: the reviewer's draft (B) or the pre-fork original (A). */
  abSide: 'draft' | 'original';
  submitting: boolean;
  onToggleAb: () => void;
  onSubmit: () => void;
  onDiscard: () => void;
}

export function SuggestModeChip({ playing, abSide, submitting, onToggleAb, onSubmit, onDiscard }: SuggestModeChipProps) {
  return (
    <div
      data-testid="suggest-mode-chip"
      className="mono"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        margin: '0 0 8px', padding: '7px 12px', borderRadius: 9, fontSize: 10,
        color: 'var(--violet)', background: 'rgba(167,139,250,0.08)',
        border: '1px solid rgba(167,139,250,0.45)',
      }}
    >
      <span style={{ fontWeight: 700, letterSpacing: '0.1em' }}>⌁ SUGGESTING</span>
      <span style={{ color: 'var(--text-2)' }}>
        {playing
          ? (abSide === 'draft' ? 'edit the rack, then Submit' : 'hearing the original — flip back to keep editing')
          : 'press play to hear your draft'}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn sm ghost"
          style={{ fontSize: 9.5 }}
          onClick={onToggleAb}
          title="Compare your draft against the pre-fork rack"
        >
          {abSide === 'draft' ? 'A/B: hearing DRAFT' : 'A/B: hearing ORIGINAL'}
        </button>
        <button type="button" className="btn sm primary" style={{ fontSize: 9.5 }} disabled={submitting} onClick={onSubmit}>
          {submitting ? 'Sending…' : '⌁ Submit suggestion'}
        </button>
        <button type="button" className="btn sm" style={{ fontSize: 9.5 }} disabled={submitting} onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}

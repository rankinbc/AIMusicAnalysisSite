/* The stage's placement control (⛶ / ⤡) — "play the visualizer full-screen
 * behind the page".
 *
 * Moved out of viz.tsx so the stage card can render it when the findings board
 * owns the box and the visualizer is not mounted in-box. Same glyph, same
 * corner, same size, so the control never appears to move.
 *
 * Its styles stay INLINE on purpose: in background mode the whole stage is
 * portaled to document.body, OUTSIDE the page's `.rdx` scope, so a scoped
 * class could not reach it. That is CLAUDE.md's dynamic-value exemption.
 */
export function StagePlacementButton({ bgMode, onChange, context = 'visualizer' }: {
  bgMode: boolean;
  onChange: (v: boolean) => void;
  /** Which stage content the button is sitting on. Changes only the wording. */
  context?: 'visualizer' | 'findings';
}) {
  const title =
    context === 'findings'
      ? bgMode
        ? 'Stop the background visualizer'
        : 'Play the visualizer full-screen behind the page'
      : bgMode
        ? 'Exit background mode'
        : 'Play full-screen in the background';
  return (
    <button
      type="button"
      onClick={() => onChange(!bgMode)}
      title={title}
      aria-label={title}
      className="mono"
      style={{
        position: 'absolute', top: 12, right: 12, zIndex: 6,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 34, height: 34, fontSize: 15, lineHeight: 1, cursor: 'pointer',
        color: '#fff', background: 'rgba(8,18,22,0.55)', backdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8,
      }}
    >
      {bgMode ? '⤡' : '⛶'}
    </button>
  );
}

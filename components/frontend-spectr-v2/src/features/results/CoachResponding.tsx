// Visual "the coach is responding" cues for the last assistant bubble in
// CoachChat. Purely decorative (aria-hidden): screen readers get the same
// information from CoachChat's two aria-live regions, so announcing the
// animation as well would double-speak every reply.
import s from './CoachResponding.module.css';

/** Waiting for the first token — three bouncing dots in place of the text. */
export function TypingDots() {
  return (
    <span className={s.typing} aria-hidden="true" data-testid="coach-typing">
      <span />
      <span />
      <span />
    </span>
  );
}

/** Tokens are streaming in — a blinking caret at the end of the text. */
export function StreamCaret() {
  return <span className={s.caret} aria-hidden="true" data-testid="coach-caret" />;
}

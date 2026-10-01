/* The coach's "still working" lines — keep the user confident through long
 * stretches with no new result (phase 1 alone runs 55–85 s). Templates are
 * tied to what's running right now; each fires once, only after a quiet
 * spell, and never more than the context has lines for. Pure — the clock
 * and the chat log live in useLiveNarration. */
import { COACH, type ChatMessage } from './coachNarration';
import type { RunStatus } from './liveRun';
import type { SpecialistStage } from './specialist-stage';

const WAIT_TEXT: Record<string, string[]> = {
  queue: ['Still waiting on a free worker — your spot is held.', 'Busy moment on the analysis workers — I haven’t forgotten you.'],
  'phase:1': [
    'Still measuring — loudness range, transients and the stereo image take a moment.',
    'Working through the full spectrum now — this first pass is the longest one.',
    'Nearly through the core mix analysis — the next steps move faster.',
  ],
  'phase:2': ['Listening for genre cues — tempo, drum patterns, energy…'],
  'phase:3': ['Scoring the mix against what this genre usually looks like…'],
  'phase:4': ['Checking where your elements fight over the same frequencies…', 'Still untangling the frequency overlaps…'],
  'phase:5': ['Lining your mix up against the reference…'],
  'phase:6': ['Comparing against pro tracks in your genre…'],
  'phase:7': ['Mapping the arrangement…'],
  'phase:9': ['Testing how it translates to mono, speakers and headphones…'],
  'phase:8': ['Reading through your Ableton project…'],
  triage: [
    'Reading through everything I measured to pick the right specialists…',
    'Still choosing — I only bring in the ones your mix actually needs.',
  ],
  specialists: [
    'The specialists are digging in — each one takes about a minute.',
    'Still working through the deep dives — they’re thorough.',
    'Almost there — waiting on the last specialist.',
  ],
};

/** First "still working" line this long into a context… */
export const WAIT_FIRST_SEC = 15;
/** …then one more every this long… */
export const WAIT_GAP_SEC = 22;
/** …and only when the chat has been quiet at least this long. */
export const WAIT_QUIET_SEC = 10;

/** What the user is waiting on right now, or null when nothing is pending. */
export function waitContext(args: {
  status: RunStatus;
  runningPhase: number | null;
  stage: SpecialistStage;
}): string | null {
  if (args.status === 'queued') return 'queue';
  if (args.status === 'analyzing') return args.runningPhase === null ? null : `phase:${args.runningPhase}`;
  if (!args.stage.planReady) return 'triage';
  if (args.stage.total > 0 && !args.stage.complete) return 'specialists';
  return null;
}

/** The next "still working" message for `ctx`, if one is due.
 *  @param sent  how many this context has already produced. */
export function dueWaitLine(
  ctx: string,
  elapsedSec: number,
  quietSec: number,
  sent: number,
): ChatMessage | null {
  const lines = WAIT_TEXT[ctx];
  if (!lines || sent >= lines.length) return null;
  if (elapsedSec < WAIT_FIRST_SEC + sent * WAIT_GAP_SEC) return null;
  if (quietSec < WAIT_QUIET_SEC) return null;
  return { id: `wait:${ctx}:${sent}`, speaker: COACH, parts: [lines[sent]!], tone: 'info' };
}

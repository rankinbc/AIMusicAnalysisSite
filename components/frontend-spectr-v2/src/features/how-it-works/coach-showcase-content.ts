// Copy for the "Meet the Coach" showcase (CoachShowcase.tsx). The intro is
// the owner's line, lightly polished. The question and answer are a REAL
// exchange from the demo track's coach conversation (exported from
// production); the answer is verbatim, trimmed after its third sentence.
// The chips are the demo analysis's real measurements the coach cited in that
// conversation (low-mid 7.9 dB above mid; low-mid −36.4 dB vs mid −44.3 dB —
// the same numbers as the mud finding in landing/sample/sample-data.ts).
// Do not edit the quoted text.
import type { CoachEvidenceDto } from '../../api/types';

export const COACH_INTRO =
  'Once your analysis is complete, you can chat with me about your track. I’ll have all of your analysis data in front of me, and I’ll answer your questions with the measurements behind every suggestion. Together we’ll get your mix sounding polished and professional.';

export const DEMO_QUESTION = 'How do I clean up the low-mid mud without making the mix sound thin?';

/** First three sentences of the coach's real reply, verbatim. */
export const DEMO_ANSWER =
  "Sweep a parametric EQ through 200–500 Hz on your mix bus or problem sources (bass, pads, keys) to find the exact frequency causing congestion — it'll jump out as muddy or boxy. Cut that spot 2–4 dB with a narrow Q (1.5–3.0), not a broad scoop. To avoid thinness, leave 80–150 Hz (bass fundamental) and 500–800 Hz (body/warmth) untouched, and boost 1–2 dB around 3–5 kHz to restore perceived thickness by adding clarity.";

/** `path: ''` = static chip (EvidenceChips renders no scroll button). */
export const DEMO_EVIDENCE: CoachEvidenceDto[] = [
  { label: 'Low-mid 7.9 dB above mid', path: '' },
  { label: 'Low-mid −36.4 dB', path: '' },
  { label: 'Mid −44.3 dB', path: '' },
];

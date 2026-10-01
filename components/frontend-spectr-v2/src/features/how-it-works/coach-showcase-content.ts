// Copy for the "Meet the Coach" showcase (CoachShowcase.tsx). The intro is
// the owner's line, lightly polished. The question and answer are a REAL
// exchange from the demo track's coach conversation (exported from
// production); the answer is verbatim, trimmed after its third sentence.
// The chips are the demo analysis's real measurements quoted in that
// conversation — see landing/sample/sample-data.ts (stereo correlation 0.72,
// width 14%, width consistency 38%). Do not edit the quoted text.
import type { CoachEvidenceDto } from '../../api/types';

export const COACH_INTRO =
  'Once your analysis is complete, you can chat with me about your track. I’ll have all of your analysis data in front of me, and I’ll answer your questions with the measurements behind every suggestion. Together we’ll get your mix sounding polished and professional.';

export const DEMO_QUESTION = 'How do I get the supersaws wider without losing mono compatibility?';

/** First three sentences of the coach's real reply, verbatim. */
export const DEMO_ANSWER =
  'Widen your supersaws using mid-side EQ or stereo imaging on the high-mids and highs only — boost the sides above 1-2 kHz while keeping everything below (bass, low-mids) tight in the center. This gives you the wide pad shimmer trance needs without spreading low frequencies that cause phase cancellation. Your current stereo correlation sits at 0.72, so you have headroom to push width aggressively — target 0.5-0.6 correlation for modern trance. …';

/** `path: ''` = static chip (EvidenceChips renders no scroll button). */
export const DEMO_EVIDENCE: CoachEvidenceDto[] = [
  { label: 'Correlation 0.72', path: '' },
  { label: 'Width 14%', path: '' },
  { label: 'Width consistency 38%', path: '' },
];

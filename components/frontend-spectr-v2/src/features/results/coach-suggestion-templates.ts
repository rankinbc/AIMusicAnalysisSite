// Story 1.8 / Task 4 — verdict-category-derived suggestion prompts.
// Each verdict-pipeline category gets a producer-voice question that the
// CoachChat seeds into the input bar on click. The category mapping mirrors
// the worker's verdict severity buckets (low_end, loudness, stereo, etc.).

import type { VerdictDto } from '../../api/types';

const GENERIC_FALLBACK: readonly string[] = [
  "What's the single biggest issue right now?",
  'Will this pass Spotify normalization?',
  'Give me a 3-step fix priority list.',
  'How does this compare to my genre?',
  "What's the loudness verdict in plain English?",
  'Where would you start tonight?',
] as const;

// category slug → producer-voice prompt template. Categories the worker
// emits today are the verdict-pipeline severity buckets; unknown slugs
// fall through to a category-name-derived prompt so a new specialist
// won't disappear from the chip rail before this map is updated.
const TEMPLATES: Record<string, string> = {
  low_end: "What's making my low-end muddy?",
  loudness: 'Will this pass Spotify normalization?',
  stereo: 'How is my stereo image holding up?',
  frequency: "What's the worst frequency clash here?",
  dynamics: 'Where are my dynamics getting squashed?',
  reference: "Why aren't I matching the genre reference?",
  arrangement: 'Where does the arrangement lose energy?',
  stems: 'What did the stem specialists find?',
  clipping: 'Did I clip anywhere I should worry about?',
  mono: 'Is this safe for mono playback?',
  vocal: "Where's the vocal sitting in the mix?",
  bass: 'How is the bass relating to the kick?',
  kick: 'Is my kick punching through the mix?',
  transient: 'Which transients need attention?',
};

/** Title-case + spaces from a snake_case slug. `"stem_balance"` → `"Stem Balance"`. */
function humanize(slug: string): string {
  return slug
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Severity ordering — higher is more urgent. Used to surface the highest-impact
 *  categories first when there are more than 6 verdicts. */
const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  severe: 4,
  warning: 4,
  moderate: 3,
  minor: 2,
  info: 2,
  win: 1,
  fixed: 1,
};

function severityRank(v: VerdictDto): number {
  return SEVERITY_RANK[v.severity?.toLowerCase()] ?? 0;
}

/** Pick up to 6 chip prompts for the current report.
 *
 * Algorithm:
 *   1. Filter out dismissed / applied verdicts (already off the user's radar).
 *   2. Group by category, keep the highest-severity verdict per category.
 *   3. Sort by severity DESC, then priority_score DESC.
 *   4. Take the first 6 categories, map to a template prompt.
 *   5. If fewer than 6 categories surface, top up with the generic fallback
 *      (preserving uniqueness so the same prompt doesn't appear twice).
 *
 * For empty / null verdicts (degraded analysis, story 1.4), returns the
 * generic fallback verbatim.
 */
export function deriveCoachSuggestions(verdicts: readonly VerdictDto[] | null | undefined): string[] {
  if (!verdicts || verdicts.length === 0) {
    return [...GENERIC_FALLBACK];
  }

  const open = verdicts.filter((v) => !v.userState?.dismissed && !v.userState?.applied);
  if (open.length === 0) {
    return [...GENERIC_FALLBACK];
  }

  // Highest-severity-per-category bucket
  const byCategory = new Map<string, VerdictDto>();
  for (const v of open) {
    const key = (v.category ?? '').toLowerCase();
    if (!key) continue;
    const incumbent = byCategory.get(key);
    if (!incumbent || severityRank(v) > severityRank(incumbent)) {
      byCategory.set(key, v);
    }
  }

  const ranked = Array.from(byCategory.values()).sort((a, b) => {
    const sev = severityRank(b) - severityRank(a);
    if (sev !== 0) return sev;
    return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
  });

  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of ranked) {
    if (out.length >= 6) break;
    const key = (v.category ?? '').toLowerCase();
    const prompt = TEMPLATES[key]
      ?? `What did you find about ${humanize(key).toLowerCase()}?`;
    if (seen.has(prompt)) continue;
    seen.add(prompt);
    out.push(prompt);
  }

  // Top up with generic fallback if categories ran short
  for (const generic of GENERIC_FALLBACK) {
    if (out.length >= 6) break;
    if (seen.has(generic)) continue;
    seen.add(generic);
    out.push(generic);
  }

  return out;
}

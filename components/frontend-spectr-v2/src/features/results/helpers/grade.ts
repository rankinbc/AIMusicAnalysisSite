// Grade letter → CSS variable + display label helpers.
// `final_json.grade` is the source; it may be null, undefined, or any string.
// Treat anything outside A–F as "not available" so a malformed pipeline output
// never blows up the report.

export type GradeLetter = 'A' | 'B' | 'C' | 'D' | 'F';

export function normalizeGrade(raw: string | null | undefined): GradeLetter | null {
  if (!raw) return null;
  const head = raw.trim().charAt(0).toUpperCase();
  if (head === 'A' || head === 'B' || head === 'C' || head === 'D' || head === 'F') {
    return head;
  }
  return null;
}

/** CSS variable name (e.g. "var(--grade-a)") for the given grade. */
export function gradeColor(raw: string | null | undefined): string {
  const g = normalizeGrade(raw);
  switch (g) {
    case 'A': return 'var(--grade-a)';
    case 'B': return 'var(--grade-b)';
    case 'C': return 'var(--grade-c)';
    case 'D': return 'var(--grade-d)';
    case 'F': return 'var(--grade-f)';
    default:  return 'var(--grade-na)';
  }
}

/** Display character. Returns em-dash when unknown. */
export function gradeLabel(raw: string | null | undefined): string {
  return normalizeGrade(raw) ?? '—';
}

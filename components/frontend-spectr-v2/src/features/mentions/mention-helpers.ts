/* Story 11.11 — pure @mention token helpers (unit-tested, no React).
 * Grammar mirrors the BFF MentionParser: `(?<![\w@])@([A-Za-z0-9][\w.\-]{0,29})`
 * — an '@' not preceded by a word char or another '@', then 1-30 of
 * [A-Za-z0-9._-] starting alphanumeric. Suggesting anything the parser would
 * not subsequently match would produce dead mentions. */

export interface ActiveMention {
  /** Index of the '@' in the text. */
  start: number;
  /** The partial handle typed after '@' (may be '' right after typing '@'). */
  query: string;
}

const TOKEN_CHAR = /[A-Za-z0-9._-]/;
const ALNUM = /[A-Za-z0-9]/;
// Unicode, to match .NET's \w in the parser's lookbehind: 'é@aur' must NOT
// trigger here because MentionParser won't resolve it (é is a word char).
const WORD = /[\p{L}\p{N}_]/u;

/** The @token the caret is currently inside/at the end of, or null. */
export function activeMentionQuery(text: string, caret: number): ActiveMention | null {
  if (caret < 1 || caret > text.length) return null;

  // Walk left from the caret over token chars to find a candidate '@'.
  let i = caret - 1;
  while (i >= 0 && TOKEN_CHAR.test(text[i]!)) i--;
  if (i < 0 || text[i] !== '@') return null;

  // MentionParser boundary: char before '@' must not be a word char or '@'.
  if (i > 0) {
    const before = text[i - 1]!;
    if (WORD.test(before) || before === '@') return null; // emails, a@@b
  }

  const query = text.slice(i + 1, caret);
  if (query.length > 30) return null;
  if (query.length > 0 && !ALNUM.test(query[0]!)) return null; // '@.x' isn't a mention

  return { start: i, query };
}

/** Replace the WHOLE active token (not just up to the caret — picking from a
 * mid-token caret must not leave tail garbage like 'hey @aurora ur ok') with
 * '@handle ' and return the new text + caret. The trailing space is skipped
 * when one already follows the token; the caret still lands after it. */
export function applyMention(
  text: string,
  active: ActiveMention,
  handle: string,
): { text: string; caret: number } {
  let end = active.start + 1 + active.query.length;
  while (end < text.length && TOKEN_CHAR.test(text[end]!)) end++;
  const spaceFollows = end < text.length && /\s/.test(text[end]!);
  const inserted = `@${handle}` + (spaceFollows ? '' : ' ');
  return {
    text: text.slice(0, active.start) + inserted + text.slice(end),
    caret: active.start + inserted.length + (spaceFollows ? 1 : 0),
  };
}

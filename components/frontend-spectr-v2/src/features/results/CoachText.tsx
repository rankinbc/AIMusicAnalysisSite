import { Fragment } from 'react';

// The coach model writes light markdown — mostly **bold** run-in headings
// ("**What I found:**", "**Top 3 priorities:**"). Rendered raw, every reply
// showed literal asterisks. Only **bold** is interpreted, into React elements
// (never innerHTML); line breaks are left to the bubble's `white-space:
// pre-wrap`. An unclosed marker — a reply still streaming — stays literal.
const BOLD = /\*\*([^*\n][^*]*?)\*\*/g;

export function CoachText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(BOLD)) {
    const start = m.index;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<strong key={start}>{m[1]}</strong>);
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}

import { Fragment, type ReactNode } from 'react';

import { GLOSSARY } from './glossary-terms';

// <Glossify> wraps known glossary terms in dotted-underline tooltip spans
// (`.gloss.term` / `.gtip` in redesign-v3-tabs.css). Terms live in
// glossary-terms.ts (react-refresh: components only here).

const GLOSS_RE = new RegExp(
  '(' +
    GLOSSARY.map(([t]) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|') +
    ')',
  'gi',
);

const BY_LOWER = new Map(GLOSSARY.map(([t, d]) => [t.toLowerCase(), d]));

/** Wrap known glossary terms in `text` with a tooltip span. */
export function Glossify({ text }: { text: string | null | undefined }): ReactNode {
  if (!text) return null;
  const parts = String(text).split(GLOSS_RE);
  return (
    <Fragment>
      {parts.map((p, i) => {
        const def = BY_LOWER.get(p.toLowerCase());
        return def ? (
          <span key={i} className="gloss term">
            {p}
            <span className="gtip">{def}</span>
          </span>
        ) : (
          p
        );
      })}
    </Fragment>
  );
}

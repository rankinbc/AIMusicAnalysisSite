import type { MoveStep } from './move-model';

// DSP-op → glyph + accent, so a fix's dsp_chain reads as a rack of modules
// rather than plain text. Matched loosely on the op type the verdict emits.
const OP_META: { match: string; glyph: string; accent: string }[] = [
  { match: 'eq', glyph: '≋', accent: 'var(--cyan)' },
  { match: 'equal', glyph: '≋', accent: 'var(--cyan)' },
  { match: 'limit', glyph: '◈', accent: 'var(--orange)' },
  { match: 'comp', glyph: '◗', accent: 'var(--violet)' },
  { match: 'glue', glyph: '◗', accent: 'var(--violet)' },
  { match: 'sidechain', glyph: '◗', accent: 'var(--violet)' },
  { match: 'gain', glyph: '▮', accent: 'var(--blue)' },
  { match: 'trim', glyph: '▮', accent: 'var(--blue)' },
  { match: 'width', glyph: '◫', accent: 'var(--blue)' },
  { match: 'stereo', glyph: '◫', accent: 'var(--blue)' },
  { match: 'pan', glyph: '◫', accent: 'var(--blue)' },
  { match: 'sat', glyph: '◆', accent: 'var(--orange)' },
  { match: 'drive', glyph: '◆', accent: 'var(--orange)' },
  { match: 'reverb', glyph: '◍', accent: 'var(--violet)' },
  { match: 'delay', glyph: '◍', accent: 'var(--violet)' },
];

function opMeta(where: string): { glyph: string; accent: string } {
  const k = where.toLowerCase();
  for (const o of OP_META) if (k.includes(o.match)) return { glyph: o.glyph, accent: o.accent };
  return { glyph: '▤', accent: 'var(--cyan)' };
}

function parseParams(detail: string): { k: string; v: string }[] {
  if (!detail) return [];
  return detail
    .split(',')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const eq = seg.indexOf('=');
      if (eq > 0) return { k: seg.slice(0, eq).trim(), v: seg.slice(eq + 1).trim() };
      return { k: '', v: seg };
    });
}

function titleizeOp(where: string): string {
  return where
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Render a fix's DSP ops as rack-module cards (glyph + accent + param rows). */
export function RackModules({ steps }: { steps: MoveStep[] }) {
  return (
    <div className="preset-mods">
      {steps.map((st, i) => {
        const meta = opMeta(st.where);
        const params = parseParams(st.detail);
        return (
          <div className="rackmod" key={i} style={{ ['--ac' as string]: meta.accent }}>
            <div className="rm-hd">
              <span className="rm-glyph" aria-hidden>
                {meta.glyph}
              </span>
              <span className="rm-name">{titleizeOp(st.where)}</span>
            </div>
            {params.length > 0 && (
              <div className="rm-params">
                {params.map((p, j) => (
                  <div className="rm-p" key={j}>
                    <span className="rm-k">{p.k || 'set'}</span>
                    <span className="rm-v">{p.v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

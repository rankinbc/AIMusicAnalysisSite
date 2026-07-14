// SPECTR · Listen V3 (PRP-3 / story 11.2) — pure helpers for reviewer suggestions.
// Kept separate from the card component so chain-summary + partition + gating are
// unit-testable without a render. `SuggestionDto.chain` is `unknown` on the wire.
import type { SuggestionDto } from '../../api/types';

/** Readable module order of a proposed chain (e.g. ['Eq', 'Compressor']). Tolerant
 *  of the `unknown` wire shape — returns [] when there's no usable `order` array. */
export function chainSummary(chain: unknown): string[] {
  if (!chain || typeof chain !== 'object') return [];
  const order = (chain as { order?: unknown }).order;
  if (!Array.isArray(order)) return [];
  return order.filter((x): x is string => typeof x === 'string' && x.length > 0).map(prettyEffect);
}

function prettyEffect(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface PartitionedSuggestions {
  /** commentId -> its suggestion (rendered inline in that comment thread). */
  byCommentId: Map<string, SuggestionDto>;
  /** suggestions not tied to a comment (rendered in the standalone list). */
  standalone: SuggestionDto[];
}

export function partitionSuggestions(suggestions: SuggestionDto[]): PartitionedSuggestions {
  const byCommentId = new Map<string, SuggestionDto>();
  const standalone: SuggestionDto[] = [];
  for (const sg of suggestions) {
    if (sg.commentId) byCommentId.set(sg.commentId, sg);
    else standalone.push(sg);
  }
  return { byCommentId, standalone };
}

/** AC2 — only the owner can accept/reject, and only while the suggestion is still
 *  open (proposed/auditioned); accepted/rejected ones are terminal. */
export function canActOnSuggestion(status: SuggestionDto['status'], isOwner: boolean): boolean {
  return isOwner && (status === 'proposed' || status === 'auditioned');
}

// ── Story 11.12 — readable move list ─────────────────────────────────────────
// The owner's "what do I do in my DAW" answer: format the proposed chain as
// human-readable mix moves. Same drift-tolerance contract as chainSummary —
// unknown shapes yield [], disabled modules and no-op params are skipped, and
// the raw chain is never mutated. Real DAW preset export stays backlog.

function fmt(n: number, digits = 1): string {
  const r = Number(n.toFixed(digits));
  return String(r);
}

function fmtHz(freq: number): string {
  return freq >= 1000 ? `${fmt(freq / 1000, 1)} kHz` : `${Math.round(freq)} Hz`;
}

type Rec = Record<string, unknown>;

function numOf(m: Rec, key: string): number | null {
  const v = m[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function eqMoves(m: Rec): string[] {
  const bands = m.bands;
  if (!Array.isArray(bands)) return [];
  const out: string[] = [];
  for (const b of bands) {
    if (!b || typeof b !== 'object') continue;
    const band = b as Rec;
    if (band.enabled === false) continue;
    const freq = numOf(band, 'freq');
    if (freq == null) continue;
    const type = typeof band.type === 'string' ? band.type : 'peaking';
    if (type === 'highpass') { out.push(`high-pass @ ${fmtHz(freq)}`); continue; }
    if (type === 'lowpass') { out.push(`low-pass @ ${fmtHz(freq)}`); continue; }
    const gain = numOf(band, 'gainDb') ?? 0;
    if (gain === 0) continue; // no-op band
    const verb = gain < 0 ? 'cut' : 'boost';
    const shelf = type === 'lowshelf' ? ' (low shelf)' : type === 'highshelf' ? ' (high shelf)' : '';
    out.push(`${verb} ${fmt(Math.abs(gain))} dB @ ${fmtHz(freq)}${shelf}`);
  }
  return out;
}

function moduleMoves(id: string, m: Rec): string[] {
  switch (id) {
    case 'eq': return eqMoves(m);
    case 'comp': {
      const ratio = numOf(m, 'ratio');
      if (ratio == null || ratio <= 1) return [];
      const thr = numOf(m, 'thresholdDb');
      const makeup = numOf(m, 'makeupDb');
      let move = `comp ${fmt(ratio)}:1${thr != null ? ` @ ${fmt(thr)} dB` : ''}`;
      if (makeup != null && makeup !== 0) move += `, makeup ${fmt(makeup)} dB`;
      return [move];
    }
    case 'limiter': {
      const ceil = numOf(m, 'ceilingDb');
      return ceil != null ? [`limiter ceiling ${fmt(ceil)} dB`] : ['limiter on'];
    }
    case 'trim': {
      const g = numOf(m, 'gainDb');
      if (g == null || g === 0) return [];
      return [`trim ${g > 0 ? '+' : ''}${fmt(g)} dB`];
    }
    case 'ms': {
      const out: string[] = [];
      const width = numOf(m, 'width');
      if (width != null && width !== 1) out.push(`width ${Math.round(width * 100)}%`);
      const monoHz = numOf(m, 'monoMakerHz');
      if (monoHz != null && monoHz > 0) out.push(`mono below ${fmtHz(monoHz)}`);
      if (m.mono === true) out.push('full mono');
      return out;
    }
    case 'sat': {
      const mix = numOf(m, 'mix');
      const drive = numOf(m, 'drive');
      if ((mix ?? 0) === 0 && (drive ?? 0) === 0) return [];
      const bits: string[] = [];
      if (drive != null && drive !== 0) bits.push(`drive ${fmt(drive)}`);
      if (mix != null && mix !== 0) bits.push(`${Math.round(mix * 100)}% mix`);
      return [`saturation ${bits.join(', ')}`];
    }
    case 'gate': {
      const thr = numOf(m, 'thresholdDb');
      return thr != null ? [`gate @ ${fmt(thr)} dB`] : ['gate on'];
    }
    default:
      // Creative modules (delay/reverb/tremolo/…) — enabled is signal enough.
      return [`${prettyEffect(id)} on`];
  }
}

/** Human-readable mix moves for a proposed chain; [] when unusable. */
export function chainToMoves(chain: unknown): string[] {
  if (!chain || typeof chain !== 'object') return [];
  const modules = (chain as { modules?: unknown }).modules;
  if (!modules || typeof modules !== 'object') return [];
  const mods = modules as Record<string, unknown>;
  const rawOrder = (chain as { order?: unknown }).order;
  const order = Array.isArray(rawOrder)
    ? rawOrder.filter((x): x is string => typeof x === 'string')
    : [];
  // Chain order first, then any moduled-but-unordered ids (drift tolerance).
  const ids = [...order, ...Object.keys(mods).filter((id) => !order.includes(id))];
  const moves: string[] = [];
  for (const id of ids) {
    if (id === 'pitch') continue;
    const m = mods[id];
    if (!m || typeof m !== 'object') continue;
    const rec = m as Rec;
    if (rec.enabled !== true) continue; // disabled modules are not moves
    moves.push(...moduleMoves(id, rec));
  }
  return moves;
}

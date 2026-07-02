/* Story 11.4 — pure presentational pieces for the anon reviewer page so the
 * gating matrix is static-render testable (AC5). The route container owns the
 * hooks; these components only read props. */
import type { CommentDto, GatesDto } from '../../api/types';

import { Pill } from '../../ui/Pill';

// ── gating matrix (AC2) — pills reflect the server-resolved gates ────────────
export function AnonGatePills({ gates }: { gates: GatesDto }) {
  return (
    <div data-testid="gate-pills" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {gates.canComment && <Pill tone="cyan">comments open</Pill>}
      {gates.canSuggest && <Pill tone="violet">suggestions open</Pill>}
      {gates.canBookmark && <Pill>bookmarks open</Pill>}
      {!gates.canComment && !gates.canSuggest && !gates.canBookmark && (
        <Pill>listen only</Pill>
      )}
    </div>
  );
}

function fmt(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// ── threaded comment list (flat two-level render, timestamp seek) ────────────
export function AnonCommentList({
  comments,
  onSeek,
}: {
  comments: CommentDto[];
  onSeek?: (t: number) => void;
}) {
  const roots = comments.filter((c) => c.parentId === null);
  const childrenOf = (id: string) => comments.filter((c) => c.parentId === id);

  if (comments.length === 0) {
    return <p className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>No comments yet — be the first ear.</p>;
  }

  const row = (c: CommentDto, depth: number) => (
    <li
      key={c.id}
      data-depth={depth}
      style={{ listStyle: 'none', marginLeft: depth * 22, padding: '8px 0', borderBottom: '1px solid var(--border)' }}
    >
      <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
        {c.t != null && (
          <button
            type="button"
            className="mono"
            onClick={() => onSeek?.(c.t!)}
            style={{ background: 'none', border: 'none', color: 'var(--cyan)', cursor: 'pointer', padding: 0, fontSize: 10 }}
          >
            @{fmt(c.t)}
          </button>
        )}
        <span>{c.author.handle ?? c.author.displayName ?? 'anon'}</span>
        {c.status !== 'open' &&
          (c.status === 'pinned'
            ? <Pill tone="cyan">{c.status}</Pill>
            : <Pill>{c.status}</Pill>)}
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 13.5, lineHeight: 1.5 }}>{c.body}</p>
    </li>
  );

  return (
    <ul style={{ margin: 0, padding: 0 }}>
      {roots.map((c) => [row(c, 0), ...childrenOf(c.id).map((r) => row(r, 1))])}
    </ul>
  );
}

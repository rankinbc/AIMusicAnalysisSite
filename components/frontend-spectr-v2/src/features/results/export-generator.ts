// Real DAW-plan export generator (v4 Task 6). Pure and heavily unit-tested —
// the SAME function drives the ExportModal live preview and the downloaded
// file, so the config panel can never drift from the emitted document.

import type { Move } from './move-model';
import type { ExportFacts } from './ExportModal';
import { perDeviceGroups } from './improvement-plan-model';

export type ExportFormat = 'md' | 'txt';
export type ExportDetail = 'brief' | 'standard' | 'detailed';
export type ExportOrder = 'order' | 'area';
export type ExportOptKey = 'facts' | 'params' | 'data' | 'targets' | 'coach' | 'perDevice';

export interface ExportConfig {
  format: ExportFormat;
  detail: ExportDetail;
  order: ExportOrder;
  opts: Record<ExportOptKey, boolean>;
  selectedIds: ReadonlySet<string>;
}

export interface ExportResult {
  filename: string;
  mime: string;
  content: string;
}

export const DEFAULT_EXPORT_OPTS: Record<ExportOptKey, boolean> = {
  facts: true,
  params: true,
  data: true,
  targets: true,
  coach: false,
  perDevice: false,
};

// Static platform loudness targets (the prototype's scenario.streaming top 3).
export const STREAM_TARGETS: { platform: string; target: number }[] = [
  { platform: 'Spotify', target: -14 },
  { platform: 'Apple Music', target: -16 },
  { platform: 'YouTube', target: -14 },
];

function slug(name: string): string {
  return (
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'daw-plan'
  );
}

/** Selected moves in the configured order. 'order' keeps the given (signal
 *  chain) order; 'area' groups by problem area/scope alphabetically. */
export function selectMoves(cfg: ExportConfig, moves: Move[]): Move[] {
  const sel = moves.filter((m) => cfg.selectedIds.has(m.id));
  if (cfg.order === 'area') return [...sel].sort((a, b) => a.scope.localeCompare(b.scope));
  return sel;
}

export function generateGamePlan(
  cfg: ExportConfig,
  moves: Move[],
  facts: ExportFacts,
  extras: { trackName: string; versionLabel?: string | null | undefined },
): ExportResult {
  const sel = selectMoves(cfg, moves);
  const lines: string[] = [];
  const title = `# Mixing plan — ${extras.trackName}${extras.versionLabel ? ` ${extras.versionLabel}` : ''}`;
  lines.push(title, '');

  if (cfg.opts.facts) {
    lines.push('## Track facts', '');
    lines.push(`- Tempo: ${facts.bpm != null ? `${Math.round(facts.bpm)} BPM` : '—'}`);
    lines.push(`- Key: ${facts.key || '—'}`);
    lines.push(`- Loudness: ${facts.lufs != null ? `${facts.lufs.toFixed(1)} LUFS` : '—'}`);
    lines.push(`- Genre: ${facts.genre || '—'}`);
    lines.push('');
  }

  lines.push(
    `## Moves · by ${cfg.order === 'order' ? 'signal chain' : 'problem area'}`,
    '',
  );
  if (sel.length === 0) {
    lines.push('_No fixes selected._', '');
  }
  sel.forEach((m, i) => {
    const scope = m.scope ? ` (${m.scope})` : '';
    lines.push(`${i + 1}. [ ] **${m.title}**${scope}`);
    lines.push(`   → ${m.directive}`);
    if (cfg.detail !== 'brief') {
      if (cfg.opts.params && m.steps.length > 0) {
        for (const st of m.steps) {
          const detail = cfg.detail === 'detailed' && st.detail ? `: \`${st.detail}\`` : '';
          lines.push(`   - ${st.where}${detail}`);
        }
      }
      if (cfg.opts.coach && m.why) {
        lines.push(`   _Why: ${m.why}_`);
      }
    }
    if (cfg.detail === 'detailed' && cfg.opts.data && m.evidence.metric) {
      lines.push(`   ↳ measured: \`${m.evidence.metric}\``);
    }
    lines.push('');
  });

  if (cfg.opts.perDevice && sel.length > 0) {
    lines.push('## Actions per device', '');
    for (const g of perDeviceGroups(sel)) {
      lines.push(`### ${g.device === 'Master' ? 'Master' : `Device: ${g.device}`}`, '');
      for (const m of g.moves) {
        lines.push(`- [ ] ${m.title}`);
      }
      lines.push('');
    }
  }

  if (cfg.opts.targets) {
    lines.push('## Streaming targets', '');
    for (const t of STREAM_TARGETS) {
      lines.push(`- ${t.platform}: ${t.target} LUFS`);
    }
    lines.push('');
  }

  const md = lines.join('\n');
  const content = cfg.format === 'txt' ? stripMarkdown(md) : md;
  return {
    filename: `daw-plan-${slug(extras.trackName)}.${cfg.format}`,
    mime: cfg.format === 'txt' ? 'text/plain' : 'text/markdown',
    content,
  };
}

/** txt = the markdown with syntax stripped, layout preserved. */
export function stripMarkdown(md: string): string {
  return md
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        .replace(/`([^`]*)`/g, '$1'),
    )
    .join('\n');
}

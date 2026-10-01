// @vitest-environment jsdom
/* The board header at narrow widths (the 276px Actions list column, in the
 * report AND inside the Listen stage): the title used to be squeezed to ~9px by
 * the controls' min-content and painted over the PRIORITY label. jsdom has no
 * layout, so this locks (a) the DOM grouping the CSS relies on and (b) the CSS
 * rules that make the header wrap. Measured in Chromium: title, Select all, the
 * priority pill and Filter each land on their own row at 276px, one row at
 * report width. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import { FixBoard } from '../FixBoard';

afterEach(cleanup);

const VERDICT = {
  id: 'v1', analysisId: 'a1', specialist: 'low_end', promptVersion: '1', model: 'test',
  severity: 'critical', category: 'low_end', confidence: 0.8, priorityScore: 120,
  impact: null, chartType: null, headline: 'Sub is masking the kick',
  summary: 'x', body: null, metricLine: null, whyItMatters: null, presetName: null,
  evidence: null, fix: null, sources: null, problemId: 'p1', kind: 'fault',
  source: 'rule_engine', dataTier: 'audio_only', fixable: false, suspected: false,
  where: null, refines: null, priorityBase: null, priorityCategoryWeight: null,
  priorityScopeMultiplier: null, scope: null, createdAt: '2026-09-19T00:00:00Z',
  userState: { dismissed: false, applied: false, feedback: null },
} as VerdictDto;

function header(mode: 'actions' | 'findings') {
  const { container } = render(
    <FixBoard
      mode={mode}
      verdicts={[VERDICT]}
      moves={[]}
      committedIds={new Set<string>()}
      onToggleCommit={vi.fn()}
      checkedNoteIds={new Set<string>()}
      onToggleNote={vi.fn()}
      focusId={null}
      onConsumeFocus={vi.fn()}
      onShowFix={vi.fn()}
      onShowFinding={vi.fn()}
    />,
  );
  const lh = container.querySelector('.fb-lh');
  if (!lh) throw new Error('no header');
  return lh;
}

describe('FixBoard header layout', () => {
  it('Actions: title + Select all on the title row, the filters wrappable beneath', () => {
    const lh = header('actions');
    // Owner 2026-10-01 (Actions at the top): Select all sits beside the title;
    // the priority pill + Filter share the row below.
    expect(Array.from(lh.children).map((c) => c.className)).toEqual(['fb-lt', 'fpill selall', 'fb-filters']);
    expect(lh.querySelector('.fb-lt .t')?.textContent).toBe('Actions');
    const filters = lh.querySelector('.fb-filters');
    if (!filters) throw new Error('no filters');
    // The priority pill and the Filter dropdown — two flex items, so each can
    // drop to its own row.
    expect(filters.children).toHaveLength(2);
    expect(filters.children[0]?.classList.contains('fb-prio')).toBe(true);
    expect(filters.children[1]?.classList.contains('fb-filterdd')).toBe(true);
  });

  it('Findings: no Select all, same two-group header', () => {
    const lh = header('findings');
    expect(lh.querySelector('.fb-lt .t')?.textContent).toBe('Findings');
    expect(lh.querySelector('.selall')).toBeNull();
  });

  it('the header and title group wrap instead of overlapping (CSS lock)', () => {
    const css = readFileSync(resolve(__dirname, '../redesign-v3-tabs.css'), 'utf8');
    // Body of the FIRST rule whose selector is exactly `sel` at line start.
    const rule = (sel: string) => {
      const at = css.split(/\r?\n/).find((line) => line.startsWith(`${sel} {`));
      return at ?? '';
    };
    expect(rule('.rdx .fb-lh')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.rdx .fb-lt')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.rdx .fb-lt .t')).toMatch(/white-space:\s*nowrap/);
    expect(rule('.rdx .fb-filters')).toMatch(/flex-wrap:\s*wrap/);
  });
});

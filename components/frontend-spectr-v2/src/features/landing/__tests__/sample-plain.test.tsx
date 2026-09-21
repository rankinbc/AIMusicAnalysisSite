import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GLOSSARY } from '../../results/glossary-terms';
import { SampleReportEmbed } from '../SampleReportEmbed';
import { SAMPLE_REPORT } from '../sample-report';
describe('sample report — readable without audio vocabulary', () => {
  it('every finding has a plain sentence, in words only (no invented numbers)', () => {
    for (const f of SAMPLE_REPORT.findings) {
      expect(f.plain.length).toBeGreaterThan(40);
      expect(f.plain).not.toMatch(/\d/);
    }
    expect(SAMPLE_REPORT.plainSummary).not.toMatch(/\d/);
  });
  it('the plain lines are visible text, not tooltips', () => {
    const html = renderToStaticMarkup(<SampleReportEmbed />);
    for (const f of SAMPLE_REPORT.findings) expect(html).toContain(f.plain.slice(0, 30));
    expect(html).toContain('In plain English');
    expect(html).not.toContain('gtip');
  });
  it('glosses LUFS from the shared glossary and links the full report in the demo', () => {
    const html = renderToStaticMarkup(<SampleReportEmbed />);
    const lufs = GLOSSARY.find(([term]) => term === 'LUFS');
    expect(lufs).toBeDefined();
    expect(html).toContain(lufs![1].slice(0, 40));
    expect(html).toContain('href="/demo"');
  });
  it('the numbers still match the canonical pipeline sample', () => {
    const raw = JSON.parse(readFileSync(
      resolve(__dirname, '../../../../../../schemas/samples/sample1_8aeef3b4.json'), 'utf8',
    )) as { grade: string; overall_score: number; danceability_score: number;
            phases: Array<{ phase: number; data: { bpm: number; lufs: number; detected_key: string } }> };
    const p1 = raw.phases.find((p) => p.phase === 1)!.data;
    expect(SAMPLE_REPORT.grade).toBe(raw.grade);
    expect(SAMPLE_REPORT.overallScore).toBe(Math.round(raw.overall_score));
    expect(SAMPLE_REPORT.danceability).toBe(raw.danceability_score);
    expect(SAMPLE_REPORT.bpm).toBe(Math.round(p1.bpm));
    expect(SAMPLE_REPORT.lufs.toFixed(1)).toBe(p1.lufs.toFixed(1));
    expect(SAMPLE_REPORT.detectedKey).toBe(p1.detected_key);
  });
});

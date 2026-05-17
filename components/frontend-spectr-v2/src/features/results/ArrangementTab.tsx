import s from './ArrangementTab.module.css';

interface StubSection {
  name: string;
  bars: number;
  flag?: boolean;
}

const SECTIONS: StubSection[] = [
  { name: 'Intro', bars: 16 },
  { name: 'Buildup', bars: 32 },
  { name: 'Drop', bars: 32, flag: true },
  { name: 'Breakdown', bars: 16 },
  { name: 'Outro', bars: 16 },
];

const ISSUES = [
  'Drop ends abruptly at bar 96 — needs a 4-bar release tail',
  'Breakdown lacks a buildup tail — energy reset feels harsh',
];

const SECTION_COLOR: Record<string, string> = {
  Intro: 'rgba(0, 229, 176, 0.08)',
  Buildup: 'rgba(167, 139, 250, 0.10)',
  Drop: 'rgba(251, 146, 60, 0.10)',
  Breakdown: 'rgba(96, 165, 250, 0.10)',
  Outro: 'rgba(255, 255, 255, 0.04)',
};

export function ArrangementTab() {
  const total = SECTIONS.reduce((acc, sec) => acc + sec.bars, 0);
  return (
    <section className={`card ${s.card}`}>
      <div className={s.hd}>
        <span className={s.title}>Arrangement</span>
        <span className={s.score} style={{ color: 'var(--cyan)' }}>
          score 72/100
        </span>
      </div>

      <div className={s.bar}>
        {SECTIONS.map((sec) => (
          <div
            key={sec.name}
            className={s.section}
            data-flag={sec.flag ? 'true' : 'false'}
            style={
              {
                flex: sec.bars / total,
                ['--sec-bg' as string]: SECTION_COLOR[sec.name] ?? 'rgba(255,255,255,0.04)',
              } as React.CSSProperties
            }
          >
            <span>{sec.name}</span>
            <span className={s.sectionBars}>{sec.bars} bars</span>
          </div>
        ))}
      </div>

      <div className={s.issues}>
        <span className={s.issuesTitle}>Arrangement issues</span>
        {ISSUES.map((issue) => (
          <div key={issue} className={s.issue}>
            <span className={s.issueGlyph}>▲</span>
            <span className={s.issueText}>{issue}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

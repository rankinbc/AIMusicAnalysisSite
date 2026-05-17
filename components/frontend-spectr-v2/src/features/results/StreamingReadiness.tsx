// Per-platform LUFS readiness table + true-peak + clipping rows.
// Verdicts are colored via inline style (helper returns a CSS var).

import { fmtDb, fmtLufs } from './helpers/format';
import {
  PLATFORM_TARGETS,
  TRUE_PEAK_CEILING_DB,
  evaluateClipping,
  evaluateLufs,
  evaluateTruePeak,
  verdictColor,
  type LufsVerdict,
} from './helpers/streaming';
import s from './StreamingReadiness.module.css';

interface StreamingReadinessProps {
  lufs: number | undefined;
  truePeakDb: number | undefined;
  clippingDetected: boolean | undefined;
}

interface Row {
  key: string;
  platform: string;
  target: string;
  yourValue: string;
  verdict: LufsVerdict;
}

const VERDICT_LABEL: Record<LufsVerdict, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  unknown: '—',
};

export function StreamingReadiness({
  lufs,
  truePeakDb,
  clippingDetected,
}: StreamingReadinessProps) {
  const platformRows: Row[] = PLATFORM_TARGETS.map((p) => ({
    key: p.name,
    platform: p.name,
    target: `${p.lufs} LUFS`,
    yourValue: fmtLufs(lufs),
    verdict: evaluateLufs(lufs, p.lufs),
  }));

  const truePeakRow: Row = {
    key: 'true-peak',
    platform: 'True Peak (≤ −1.0 dBTP)',
    target: fmtDb(TRUE_PEAK_CEILING_DB),
    yourValue: fmtDb(truePeakDb),
    verdict: evaluateTruePeak(truePeakDb),
  };

  const clippingRow: Row = {
    key: 'no-clipping',
    platform: 'No Clipping',
    target: 'OK',
    yourValue:
      clippingDetected === true
        ? 'Clipping detected'
        : clippingDetected === false
          ? 'OK'
          : '—',
    verdict: evaluateClipping(clippingDetected),
  };

  const rows: Row[] = [...platformRows, truePeakRow, clippingRow];

  return (
    <section className={s.panel}>
      <h3 className={s.heading}>Streaming Readiness</h3>
      <table className={s.table}>
        <thead>
          <tr>
            <th className={s.colPlatform} scope="col">
              Platform
            </th>
            <th className={s.colTarget} scope="col">
              Target
            </th>
            <th className={s.colYour} scope="col">
              Your Mix
            </th>
            <th className={s.colVerdict} scope="col">
              Verdict
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className={s.platform}>{row.platform}</td>
              <td className={`${s.target} mono`}>{row.target}</td>
              <td className={`${s.your} mono`}>{row.yourValue}</td>
              <td className={s.verdictCell}>
                <span
                  className={`${s.verdict} mono`}
                  style={{ color: verdictColor(row.verdict) }}
                >
                  {VERDICT_LABEL[row.verdict]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

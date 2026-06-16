import type { CreditLedgerEntryDto } from '../../api/types';
import s from './CreditLedgerTable.module.css';

// Story 2.3 / UX-DR32 — mono ledger table. Renders signed amounts with
// `+`/`-` prefix, locale-formatted dates, and tappable references for
// audit.

interface CreditLedgerTableProps {
  entries: ReadonlyArray<CreditLedgerEntryDto>;
}

const REASON_LABELS: Record<string, string> = {
  purchase: 'Purchase',
  spend: 'Spend',
  reversal: 'Reversal',
  adjustment: 'Adjustment',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

function truncateReference(ref: string | null): string {
  if (!ref) return '—';
  if (ref.length <= 14) return ref;
  return `…${ref.slice(-10)}`;
}

export function CreditLedgerTable({ entries }: CreditLedgerTableProps) {
  if (entries.length === 0) {
    return (
      <p className={s.empty}>No ledger entries yet.</p>
    );
  }
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th scope="col" className={s.th}>Date</th>
          <th scope="col" className={`${s.th} ${s.thAmount}`}>Amount</th>
          <th scope="col" className={s.th}>Reason</th>
          <th scope="col" className={s.th}>Reference</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const sign = entry.amount > 0 ? '+' : '';
          const amountClass = entry.amount > 0 ? s.amountPositive : s.amountNegative;
          return (
            <tr key={entry.id}>
              <td className={s.td}>{formatDate(entry.createdAt)}</td>
              <td className={`${s.td} ${s.tdAmount} ${amountClass}`}>
                {sign}
                {entry.amount}
              </td>
              <td className={s.td}>
                {REASON_LABELS[entry.reason] ?? entry.reason}
              </td>
              <td className={`${s.td} ${s.tdReference}`}>
                {truncateReference(entry.reference)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

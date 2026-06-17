import { toast } from 'sonner';

import { groupMoves, moveToMarkdown, type Move } from './move-model';
import s from './ExportBar.module.css';

interface ExportModalProps {
  committed: Move[];
  trackName: string;
  onClose: () => void;
  onDownload: () => void;
}

/** Visual preview of the Game Plan — a checklist, not raw markdown. */
export function ExportModal({ committed, trackName, onClose, onDownload }: ExportModalProps) {
  const { quick, deep } = groupMoves(committed);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(moveToMarkdown(committed, trackName));
      toast.success('Game Plan copied as Markdown');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const section = (label: string, items: Move[]) =>
    items.length > 0 && (
      <div className={s.section}>
        <h4 className={s.sectionTitle}>{label}</h4>
        <ul className={s.checklist}>
          {items.map((m) => (
            <li key={m.id} className={s.item}>
              <span className={s.box} aria-hidden>
                ☐
              </span>
              <span className={s.itemText}>
                {m.scope && <span className={`mono ${s.itemScope}`}>{m.scope}</span>}
                {m.scope && ' · '}
                {m.directive}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label="Game Plan preview" onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <header className={s.modalHead}>
          <div>
            <span className={s.kicker}>Game plan · export preview</span>
            <h3 className={s.modalTitle}>{trackName}</h3>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className={s.modalBody}>
          {committed.length === 0 ? (
            <p className={s.emptyState}>
              No moves in your plan yet. Hit <strong>+ Add to plan</strong> on the moves you want to
              take into Ableton, then export.
            </p>
          ) : (
            <>
              {section('⚡ Quick wins', quick)}
              {section('🛠 Deeper work', deep)}
            </>
          )}
        </div>

        <footer className={s.modalFoot}>
          <span className={s.footNote}>Ticks off in your notes app · committed moves only</span>
          <div className={s.footActions}>
            <button type="button" className="btn sm" onClick={copy} disabled={committed.length === 0}>
              ⧉ Copy .md
            </button>
            <button
              type="button"
              className="btn sm primary"
              onClick={onDownload}
              disabled={committed.length === 0}
            >
              ⇣ Download
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

import * as Dialog from '@radix-ui/react-dialog';
import { readListenFixes } from '../listen-rack/listenFixes';
import s from './SongConsole.module.css';

interface Props {
  versionId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onApplyInListen: () => void;
}

/** Map a sev string to a global pill tone class. */
function sevPillClass(sev: string): string {
  const l = sev.toLowerCase();
  if (l === 'crit' || l === 'critical') return 'pill orange';
  if (l === 'warn' || l === 'warning' || l === 'major') return 'pill violet';
  return 'pill cyan';
}

export function GamePlanViewModal({ versionId, open, onOpenChange, onApplyInListen }: Props) {
  const fixes = readListenFixes(versionId);
  const count = fixes.length;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.gamePlanOverlay} />
        <Dialog.Content className={s.gamePlanContent}>
          <Dialog.Title className={s.gamePlanTitle}>
            ◷ Game Plan{count > 0 ? ` · ${count} fix${count === 1 ? '' : 'es'}` : ''}
          </Dialog.Title>
          <Dialog.Description className={s.gamePlanDescription}>
            Fixes committed to your Listen rack — read-only here.
          </Dialog.Description>

          {count === 0 ? (
            <div className={s.gamePlanEmpty}>
              No fixes committed yet. Open in Listen to build your plan.
            </div>
          ) : (
            <div className={s.gamePlanList} role="list">
              {fixes.map((fix) => (
                <div key={fix.fixId} className={s.gamePlanRow} role="listitem">
                  <div className={s.gamePlanRowMain}>
                    <span className={s.gamePlanRowTitle}>{fix.title}</span>
                    <span className={s.gamePlanRowScope}>{fix.scope}</span>
                  </div>
                  <span className={sevPillClass(fix.sev)}>{fix.sev}</span>
                </div>
              ))}
            </div>
          )}

          <div className={s.gamePlanActions}>
            <Dialog.Close asChild>
              <button type="button" className="btn ghost sm">Close</button>
            </Dialog.Close>
            <button
              type="button"
              className="btn primary sm"
              onClick={() => {
                onApplyInListen();
                onOpenChange(false);
              }}
            >
              Apply in Listen ↗
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

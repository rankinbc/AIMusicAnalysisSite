import styles from './SongConsole.module.css';

interface VersionRowMenuProps {
  hasGamePlan?: boolean;
  onMakeCurrent: () => void;
  onEditLabel: () => void;
  onReanalyze: () => void;
  onReanalyzeRef: () => void;
  onOpenListen: () => void;
  onViewGamePlan: () => void;
  onDelete: () => void;
}

/** Pure props — no hooks. Always renders all items so renderToStaticMarkup sees them. */
export function VersionRowMenu({
  hasGamePlan,
  onMakeCurrent,
  onEditLabel,
  onReanalyze,
  onReanalyzeRef,
  onOpenListen,
  onViewGamePlan,
  onDelete,
}: VersionRowMenuProps) {
  return (
    <div className={styles.rowMenu}>
      <button className={styles.menuItem} onClick={onMakeCurrent}>◎ Make current</button>
      <button className={styles.menuItem} onClick={onEditLabel}>✎ Edit label</button>
      <button className={styles.menuItem} onClick={onReanalyze}>↻ Reanalyze</button>
      <button className={styles.menuItem} onClick={onReanalyzeRef}>↻ Reanalyze with reference</button>
      <button className={styles.menuItem} onClick={onOpenListen}>
        ▦ Open in Listen <span style={{ color: 'var(--violet)', marginLeft: 'auto' }}>↗</span>
      </button>
      {hasGamePlan && (
        <button className={styles.menuItem} onClick={onViewGamePlan}>◉ View game plan</button>
      )}
      <div className={styles.menuItemDisabled}>
        ◬ Open in Room
        <span className={`mono ${styles.menuSoonBadge}`}>soon</span>
      </div>
      <div className={styles.menuDivider} />
      <button className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={onDelete}>
        🗑 Delete version
      </button>
    </div>
  );
}

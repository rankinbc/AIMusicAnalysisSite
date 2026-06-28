import { useState } from 'react';
import type { SongDto } from '../../api/types';
import styles from './SongConsole.module.css';

interface SongHeaderProps {
  song: SongDto;
  onEdit: () => void;
  onPublish: () => void;
  onAddVersion: () => void;
  onArchive: () => void;
}

function fmtSaved(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function SongHeader({ song, onEdit, onPublish, onAddVersion, onArchive }: SongHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const versions = song.versions ?? [];
  const cur = versions.find(v => v.isCurrent) ?? versions[0] ?? null;
  const hasScore = cur?.latestResult?.score != null;
  const scoreStr = hasScore ? String(cur!.latestResult!.score) : '';
  const versionCountStr = `${versions.length} version${versions.length === 1 ? '' : 's'}`;
  const savedStr = fmtSaved(song.updatedAt);

  const handleMenuToggle = () => setMenuOpen(o => !o);
  const handleArchive = () => { onArchive(); setMenuOpen(false); };

  return (
    <div className={`card ${styles.headerWrap}`}>
      {/* Cover art */}
      <div className={styles.coverWrap} />

      {/* Info column */}
      <div className={styles.headerInfo}>
        <div className={styles.headerTop}>
          <div className={styles.headerTitleWrap}>
            <h1 className={styles.headerTitle}>{song.name}</h1>
          </div>
          <div className={styles.headerActions}>
            <button className="btn ghost sm" onClick={onEdit}>Edit</button>
            <button className="btn violet sm" onClick={onPublish}>★ Publish</button>
            <button className="btn primary sm" onClick={onAddVersion}>+ Add version</button>
            <div className={styles.headerMenuWrap}>
              <button className="btn ghost sm" onClick={handleMenuToggle} style={{ padding: '5px 8px' }}>⋯</button>
              {menuOpen && (
                <div className={styles.headerMenuDropdown}>
                  <button className={styles.menuItem} onClick={handleArchive}>⊘ Archive song</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pills row */}
        <div className={styles.headerPills}>
          {song.genreHint && <span className="pill cyan">{song.genreHint}</span>}
          <span className="pill" style={{ color: 'var(--text-2)' }}>{versionCountStr}</span>
          {hasScore && (
            <span className="pill">
              <span className="mono" style={{ color: 'var(--text)' }}>{scoreStr}</span>
              <span style={{ color: 'var(--muted)' }}>/100</span>
            </span>
          )}
          <span className="pill" style={{ color: 'var(--vis)', borderColor: 'var(--vis-bd)', background: 'var(--vis-dim)' }}>◐ private</span>
          {song.updatedAt && (
            <span className="pill" style={{ color: 'var(--muted)' }}>◷ {savedStr} saved</span>
          )}
        </div>

        {/* Tags row */}
        {song.tags && song.tags.length > 0 && (
          <div className={styles.headerTags}>
            {song.tags.map(tag => (
              <span key={tag.id} className="pill" style={{ color: 'var(--text-2)', gap: '4px' }}>
                #{tag.name}
                {tag.isPublic && (
                  <span className={`mono ${styles.tagPubBadge}`}>pub</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

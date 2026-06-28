import { useState } from 'react';
import type { SongDto } from '../../api/types';
import type { useQuickPlayer } from './useQuickPlayer';
import { ComparePanel } from './ComparePanel';
import styles from './SongConsole.module.css';

// ── Deterministic waveform bars (mirrors dc.html waveFor) ────────────────────
function hashId(s: string): number {
  // FNV-1a inspired hash → stable 32-bit int from UUID string
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

const _waveCache = new Map<string, readonly number[]>();

function waveFor(id: string): readonly number[] {
  const cached = _waveCache.get(id);
  if (cached) return cached;
  const seed = hashId(id);
  const n = 52;
  const arr: number[] = [];
  let x = (seed * 2654435761) >>> 0;
  for (let i = 0; i < n; i++) {
    x = ((x * 1103515245) + 12345) & 0x7fffffff;
    const rnd = x / 0x7fffffff;
    const env = 0.5 + 0.5 * Math.abs(Math.sin((i / n) * Math.PI * 3.3 + seed));
    arr.push(Math.max(0.14, Math.min(1, (0.3 + rnd * 0.7) * env)));
  }
  _waveCache.set(id, arr);
  return arr;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Key = 'A' | 'B';
type Player = ReturnType<typeof useQuickPlayer>;

interface QuickPlayerProps {
  song: SongDto;
  player: Player;
  onOpenListen?: (id: string) => void;
}

interface DeckProps {
  slotKey: Key;
  versionId: string | null;
  song: SongDto;
  player: Player;
  dur: number;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpenListen?: (id: string) => void;
}

function Deck({ slotKey, versionId, song, player, dur, menuOpen, onToggleMenu, onOpenListen }: DeckProps) {
  const version = song.versions.find(v => v.id === versionId) ?? null;
  if (!version) return null;

  const live = player.audible === slotKey;
  const playing = live && player.playing;
  const pos = slotKey === 'A' ? player.posA : player.posB;
  const bars = waveFor(version.id);

  // Dynamic colors
  const headColor = live ? 'var(--cyan)' : 'rgba(148,163,184,.55)';
  const headShadow = live ? '0 0 10px var(--cyan-glow)' : 'none';
  const letterColor = live ? 'var(--cyan)' : 'var(--muted)';

  // Transport button
  const transportBg = live ? 'var(--cyan)' : 'rgba(255,255,255,.04)';
  const transportColor = live ? '#06151a' : 'var(--text-2)';
  const transportBorder = live ? 'transparent' : 'var(--border-2)';
  const transportShadow = live
    ? '0 0 0 1px rgba(0,229,176,.4), 0 6px 18px -6px rgba(0,229,176,.6)'
    : 'none';

  const curTime = fmtTime(pos * dur);
  const totTime = fmtTime(dur);

  const handleSeek = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    player.seek(slotKey, f);
  };

  return (
    <div className={`${styles.deck} ${live ? styles.deckLive : ''}`}>
      {/* A/B side column */}
      <div className={styles.deckSide}>
        <span className="mono" style={{ fontSize: '15px', fontWeight: 700, color: letterColor }}>{slotKey}</span>
        <button
          onClick={() => player.play(slotKey)}
          style={{
            width: '38px', height: '38px', borderRadius: '50%', display: 'grid',
            placeItems: 'center', fontSize: '13px', flexShrink: 0, cursor: 'pointer',
            border: `1px solid ${transportBorder}`, background: transportBg,
            color: transportColor, boxShadow: transportShadow, transition: 'all .15s ease',
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
      </div>

      {/* Version + waveform */}
      <div className={styles.deckMain}>
        <div className={styles.deckTopRow}>
          {/* Version picker */}
          <div className={styles.versionPickerWrap}>
            <button className={`mono ${styles.versionPickerBtn}`} onClick={onToggleMenu}>
              <span className={styles.versionPickerN}>v{version.versionNumber}</span>
              <span className={styles.versionPickerLabel}>{version.label ?? `Version ${version.versionNumber}`}</span>
              <span className={styles.versionPickerCaret}>▾</span>
            </button>
            {menuOpen && (
              <div className={styles.versionPickerMenu}>
                <div className={`label ${styles.versionPickerMenuLbl}`}>Load into deck {slotKey}</div>
                {song.versions.map(opt => (
                  <button
                    key={opt.id}
                    className={`mono ${styles.versionPickerOpt}`}
                    onClick={() => { player.setSlot(slotKey, opt.id); onToggleMenu(); }}
                  >
                    <span className={styles.versionPickerOptN}>v{opt.versionNumber}</span>
                    <span className={styles.versionPickerOptLabel}>{opt.label ?? `Version ${opt.versionNumber}`}</span>
                    {opt.id === versionId && <span style={{ color: 'var(--cyan)' }}>●</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Live indicator */}
          {live && (
            <span className={styles.liveIndicator}>
              <span
                className={`dot ${styles.dotPulsing}`}
                style={playing ? {} : undefined}
              />
              <span className={`mono ${styles.liveLabel}`}>{playing ? 'live' : 'cued'}</span>
            </span>
          )}
        </div>

        {/* Waveform + time */}
        <div className={styles.deckTimeRow}>
          <button className={styles.waveBtn} onClick={handleSeek}>
            <div className={styles.waveInner}>
              {bars.map((hh, i) => {
                const played = (i / bars.length) <= pos;
                const bgc = live
                  ? (played ? 'var(--cyan)' : 'rgba(0,229,176,.26)')
                  : (played ? 'rgba(148,163,184,.5)' : 'rgba(148,163,184,.16)');
                return (
                  <div
                    key={i}
                    className={`${styles.waveBar} ${playing ? styles.waveBarPlaying : ''}`}
                    style={{
                      height: `${Math.round(hh * 100)}%`,
                      background: bgc,
                      boxShadow: (live && played) ? '0 0 6px var(--cyan-glow)' : undefined,
                      animationDelay: playing ? `${((i % 13) * 0.05).toFixed(2)}s` : undefined,
                    }}
                  />
                );
              })}
            </div>
            {/* Playhead */}
            <div
              className={styles.waveHead}
              style={{ left: `${(pos * 100).toFixed(2)}%`, background: headColor, boxShadow: headShadow }}
            >
              <div className={styles.waveHeadDot} style={{ background: headColor, boxShadow: headShadow }} />
            </div>
          </button>

          <span className={`mono ${styles.deckTime}`}>
            {curTime}<span style={{ color: 'var(--muted)' }}> / {totTime}</span>
          </span>
        </div>
      </div>

      {/* Open in Listen */}
      <button
        className="btn ghost sm"
        style={{ flexShrink: 0 }}
        onClick={() => onOpenListen?.(version.id)}
      >
        Open in Listen <span style={{ color: 'var(--violet)' }}>↗</span>
      </button>

      {/* Hidden audio element */}
      <audio
        ref={slotKey === 'A' ? player.audioARef : player.audioBRef}
        src={player.audioUrl(versionId) ?? undefined}
        onTimeUpdate={() => player.onTime(slotKey)}
        crossOrigin="anonymous"
        style={{ display: 'none' }}
      />
    </div>
  );
}

export function QuickPlayer({ song, player, onOpenListen }: QuickPlayerProps) {
  const [slotMenuOpen, setSlotMenuOpen] = useState<Key | null>(null);
  const [durA, setDurA] = useState(0);
  const [durB, setDurB] = useState(0);

  const toggleMenu = (key: Key) => setSlotMenuOpen(prev => prev === key ? null : key);
  const closeMenu = () => setSlotMenuOpen(null);

  const canCompare = Boolean(player.slotA && player.slotB && player.slotA !== player.slotB);

  return (
    <>
      <div className="card" style={{ overflow: 'visible' }}>
        <div className="card-hd">
          <span className="label">Quick audition · A / B</span>
          <span className="mono" style={{ fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.04em' }}>
            tap a deck to switch what you hear
          </span>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {(['A', 'B'] as const).map(key => {
            const id = key === 'A' ? player.slotA : player.slotB;
            const dur = key === 'A' ? durA : durB;
            const setDur = key === 'A' ? setDurA : setDurB;
            if (!id) return null;
            return (
              <div key={key} onLoadedMetadata={() => {
                const el = key === 'A' ? player.audioARef.current : player.audioBRef.current;
                if (el) setDur(el.duration || 0);
              }}>
                <Deck
                  slotKey={key}
                  versionId={id}
                  song={song}
                  player={player}
                  dur={dur}
                  menuOpen={slotMenuOpen === key}
                  onToggleMenu={() => toggleMenu(key)}
                  onOpenListen={onOpenListen}
                />
              </div>
            );
          })}

          {/* Dismiss menu on outside click */}
          {slotMenuOpen && (
            <div
              onClick={closeMenu}
              style={{ position: 'fixed', inset: 0, zIndex: 20 }}
            />
          )}

          {canCompare && (
            <ComparePanel song={song} slotA={player.slotA} slotB={player.slotB} />
          )}
        </div>
      </div>
    </>
  );
}

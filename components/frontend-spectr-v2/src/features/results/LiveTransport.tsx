// The analysis page's compact transport: play/pause the uploaded mix plus
// elapsed / duration. Time is tracked HERE off the media element's own events
// so a timeupdate never re-renders the page (or the results route above it).

import { useEffect, useState } from 'react';

import type { LivePlayer } from './livePlayerContext';
import s from './AnalysisCompleteModal.module.css';

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />
  </svg>
);
const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <rect x="5.5" y="4" width="4.5" height="16" rx="1.2" />
    <rect x="14" y="4" width="4.5" height="16" rx="1.2" />
  </svg>
);

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

export function LiveTransport({ player, fallbackDurationSec }: { player: LivePlayer; fallbackDurationSec?: number | undefined }) {
  const { audio, playing, unavailable, toggle } = player;
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    if (!audio) return undefined;
    const onTime = () => setTime(audio.currentTime);
    const onDur = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    onTime();
    onDur();
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onDur);
    audio.addEventListener('durationchange', onDur);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onDur);
      audio.removeEventListener('durationchange', onDur);
    };
  }, [audio]);

  const total = duration ?? fallbackDurationSec;
  return (
    <div className={s.transport} data-testid="acm-transport">
      <span className={s.transportTime}>
        {fmt(time)}
        {total ? <span className={s.transportTotal}> / {fmt(total)}</span> : null}
      </span>
      <button
        type="button"
        className={s.playBtn}
        data-playing={playing}
        onClick={toggle}
        disabled={unavailable || !audio}
        aria-label={playing ? 'Pause your track' : 'Play your track'}
        title={unavailable ? 'Couldn’t load the audio — try refreshing' : playing ? 'Pause' : 'Listen while it analyzes'}
        data-testid="acm-play"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
    </div>
  );
}

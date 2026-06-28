import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { getAccessToken } from '../../api/fetcher';
import type { VersionDto } from '../../api/types';
import { defaultSlots } from './song-helpers';

type Key = 'A' | 'B';

export function useQuickPlayer(versions: VersionDto[]) {
  const init = defaultSlots(versions);
  const [slotA, setSlotA] = useState<string | null>(init.a);
  const [slotB, setSlotB] = useState<string | null>(init.b);
  const [audible, setAudible] = useState<Key>('A');
  const [playing, setPlaying] = useState(false);
  const [posA, setPosA] = useState(0);
  const [posB, setPosB] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);

  const refOf = (k: Key) => (k === 'A' ? audioARef : audioBRef);

  const audioUrl = useCallback((id: string | null) => {
    if (!id) return undefined;
    const t = getAccessToken();
    return t ? `/api/versions/${id}/audio?t=${encodeURIComponent(t)}` : undefined;
  }, []);

  const pause = (k: Key) => { refOf(k).current?.pause(); };
  const start = (k: Key) => { void refOf(k).current?.play().catch(() => {}); };

  const play = useCallback((k: Key) => {
    setAudible(prev => {
      if (prev !== k) { pause(prev); start(k); setPlaying(true); return k; }
      // toggle on the live deck
      const el = refOf(k).current;
      if (el?.paused) { start(k); setPlaying(true); } else { pause(k); setPlaying(false); }
      return prev;
    });
  }, []);

  const seek = useCallback((k: Key, fraction: number) => {
    const el = refOf(k).current;
    if (el && el.duration) el.currentTime = Math.max(0, Math.min(1, fraction)) * el.duration;
    setAudible(prev => { if (prev !== k) { pause(prev); } return k; });
    start(k); setPlaying(true);
  }, []);

  const setSlot = useCallback((k: Key, id: string) => {
    (k === 'A' ? setSlotA : setSlotB)(id);
  }, []);

  const loadIntoA = useCallback((id: string) => {
    setSlotA(id); setAudible('A'); setHighlight(id); start('A'); setPlaying(true);
  }, []);

  // timeupdate handlers (wire onTimeUpdate on each <audio>)
  const onTime = useCallback((k: Key) => {
    const el = refOf(k).current;
    if (!el || !el.duration) return;
    (k === 'A' ? setPosA : setPosB)(el.currentTime / el.duration);
  }, []);

  return {
    slotA, slotB, audible, playing, posA, posB, highlight,
    audioARef: audioARef as RefObject<HTMLAudioElement>,
    audioBRef: audioBRef as RefObject<HTMLAudioElement>,
    audioUrl, play, seek, setSlot, loadIntoA, onTime,
  };
}

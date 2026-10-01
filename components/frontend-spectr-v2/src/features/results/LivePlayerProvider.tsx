// Owns the analysis page's audio: one <audio> for the uploaded mix
// (GET /api/versions/{id}/audio?t=<jwt>), a lazily-built MediaElementSource →
// AnalyserNode → destination graph for the background visuals, and the
// expired-URL recovery the Listen page uses (createMediaRetry). Mounted by the
// results route ABOVE the live view and ReportView, so the hand-off between
// them doesn't cut the music. Playback stops when the page that shows the
// controls goes away (attach() bookkeeping) and everything is torn down when
// the route unmounts.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { fetcher, getAccessToken } from '../../api/fetcher';
import { createMediaRetry } from '../listen/media-retry';
import { LivePlayerContext, type LivePlayer } from './livePlayerContext';

type AudioCtor = typeof AudioContext;

function audioContextCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const audioSrc = (versionId: string, token: string | null) =>
  token ? `/api/versions/${versionId}/audio?t=${encodeURIComponent(token)}` : null;

export function LivePlayerProvider({ versionId, children }: { versionId: string | null | undefined; children: ReactNode }) {
  // Dep is [versionId] ONLY — a silent token refresh must not swap the src
  // (that would reset currentTime mid-song; see CLAUDE.md audio gotchas).
  const url = useMemo(() => (versionId ? audioSrc(versionId, getAccessToken()) : null), [versionId]);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const graphFor = useRef<HTMLAudioElement | null>(null);
  const attached = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  audioRef.current = audio;

  // Media events → state; expired presign/JWT → transparent retry.
  useEffect(() => {
    if (!audio || !versionId) return undefined;
    const onPlay = () => setPlaying(true);
    const onStop = () => setPlaying(false);
    const retry = createMediaRetry({
      getSrc: async () => {
        try {
          await fetcher<unknown>({ url: '/auth/me', method: 'GET' });
        } catch {
          /* give up below if there's still no token */
        }
        return audioSrc(versionId, getAccessToken());
      },
      onGiveUp: () => {
        setPlaying(false);
        setUnavailable(true);
      },
      onResumeBlocked: () => setPlaying(false),
    });
    const onErr = () => {
      void retry.handleError(audio).then((retried) => {
        if (!retried) setPlaying(false);
      });
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onStop);
    audio.addEventListener('ended', onStop);
    audio.addEventListener('error', onErr);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onStop);
      audio.removeEventListener('ended', onStop);
      audio.removeEventListener('error', onErr);
      retry.dispose();
    };
  }, [audio, versionId]);

  // Leaving the page: stop the music and release the audio graph.
  useEffect(
    () => () => {
      // A detached <audio> keeps playing unless told otherwise.
      audioRef.current?.pause();
      graphFor.current?.pause();
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      analyserRef.current = null;
      graphFor.current = null;
    },
    [],
  );

  const pause = useCallback(() => {
    audio?.pause();
  }, [audio]);

  const toggle = useCallback(() => {
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // AudioContext on the user gesture (Chrome/Safari autoplay policy). One
    // MediaElementSource per element, ever — so build the graph once.
    if (graphFor.current !== audio) {
      const Ctor = audioContextCtor();
      if (Ctor) {
        try {
          const ctx = new Ctor();
          const source = ctx.createMediaElementSource(audio);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.82;
          source.connect(analyser);
          analyser.connect(ctx.destination);
          ctxRef.current = ctx;
          analyserRef.current = analyser;
        } catch {
          // No analyser — the song still plays, the visuals idle-animate.
        }
      }
      graphFor.current = audio;
    }
    void ctxRef.current?.resume().catch(() => {});
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => setPlaying(false));
  }, [audio]);

  const getAnalyser = useCallback(() => analyserRef.current, []);

  const attach = useCallback(() => {
    attached.current += 1;
    return () => {
      attached.current -= 1;
      // Deferred: the live view → report hand-off unmounts one analysis page
      // and mounts the next in the same commit; only a real "nobody is
      // showing the controls any more" stops playback.
      setTimeout(() => {
        if (attached.current === 0) audioRef.current?.pause();
      }, 0);
    };
  }, []);

  const value = useMemo<LivePlayer | null>(
    () => (url ? { playing, unavailable, toggle, pause, audio, getAnalyser, attach } : null),
    [url, playing, unavailable, toggle, pause, audio, getAnalyser, attach],
  );

  return (
    <LivePlayerContext.Provider value={value}>
      {url && <audio ref={setAudio} src={url} preload="metadata" crossOrigin="anonymous" hidden />}
      {children}
    </LivePlayerContext.Provider>
  );
}

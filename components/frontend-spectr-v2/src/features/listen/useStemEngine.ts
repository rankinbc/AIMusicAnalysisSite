import { useEffect, useMemo, useRef } from 'react';
import { computeStemGains, type StemControl } from './stemGains';

export interface StemSource {
  id: string;
  url: string;   // /api/versions/{id}/stems/{stemId}/audio?t=<jwt>
}

export interface StemEngineHandle {
  /** (Re)build the graph for these stems. Idempotent per id+url set. */
  load: (stems: StemSource[]) => void;
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  /** Push the latest control state; recomputes effective gains. */
  setControls: (controls: StemControl[]) => void;
  currentTime: () => number;
  duration: () => number;
  /** Master analyser for the visualizer/meters in stem mode. */
  analyser: () => AnalyserNode | null;
  teardown: () => void;
}

interface StemNode {
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode;
  gain: GainNode;
}

export function useStemEngine(getContext: () => AudioContext): StemEngineHandle {
  const nodesRef = useRef<Map<string, StemNode>>(new Map());
  const masterRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const keyRef = useRef<string>('');

  const handle = useMemo<StemEngineHandle>(() => {
    const ensureMaster = (ctx: AudioContext) => {
      if (!masterRef.current) {
        const master = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        master.connect(analyser);
        analyser.connect(ctx.destination);
        masterRef.current = master;
        analyserRef.current = analyser;
      }
      return masterRef.current;
    };

    return {
      load(stems) {
        const ctx = getContext();
        // Key includes the URL so a rotated ?t= token forces a rebuild.
        const key = stems.map((s) => `${s.id}\n${s.url}`).sort().join('|');
        if (key === keyRef.current && nodesRef.current.size === stems.length) return; // already built
        // Tear down old nodes.
        for (const n of nodesRef.current.values()) {
          try { n.src.disconnect(); n.gain.disconnect(); n.el.pause(); } catch { /* noop */ }
        }
        nodesRef.current.clear();
        const master = ensureMaster(ctx);
        for (const stem of stems) {
          const el = new Audio();
          el.crossOrigin = 'anonymous';
          el.preload = 'auto';
          el.src = stem.url;
          const src = ctx.createMediaElementSource(el);
          const gain = ctx.createGain();
          gain.gain.value = 1;
          src.connect(gain);
          gain.connect(master);
          nodesRef.current.set(stem.id, { el, src, gain });
        }
        keyRef.current = key;
      },

      async play() {
        const ctx = getContext();
        if (ctx.state === 'suspended') await ctx.resume();
        await Promise.all([...nodesRef.current.values()].map((n) => n.el.play()));
      },

      pause() {
        for (const n of nodesRef.current.values()) n.el.pause();
      },

      seek(seconds) {
        for (const n of nodesRef.current.values()) n.el.currentTime = seconds;
      },

      setControls(controls) {
        const gains = computeStemGains(controls);
        const ctx = masterRef.current?.context;
        for (const [id, node] of nodesRef.current) {
          const g = gains[id] ?? 0;
          if (ctx) node.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.01);
          else node.gain.gain.value = g;
        }
      },

      currentTime() {
        const first = nodesRef.current.values().next().value as StemNode | undefined;
        return first?.el.currentTime ?? 0;
      },

      duration() {
        const first = nodesRef.current.values().next().value as StemNode | undefined;
        const d = first?.el.duration ?? 0;
        return Number.isFinite(d) ? d : 0;
      },

      analyser() { return analyserRef.current; },

      teardown() {
        for (const n of nodesRef.current.values()) {
          try { n.src.disconnect(); n.gain.disconnect(); n.el.pause(); n.el.src = ''; } catch { /* noop */ }
        }
        nodesRef.current.clear();
        try { masterRef.current?.disconnect(); analyserRef.current?.disconnect(); } catch { /* noop */ }
        masterRef.current = null;
        analyserRef.current = null;
        keyRef.current = '';
      },
    };
    // Freeze identity: all methods close over refs, never React state (project gotcha).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => handle.teardown(), [handle]);

  return handle;
}

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import {
  EQ_BANDS_DEFAULT,
  COMPRESSOR_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
  type EqBand,
  type CompressorState,
  type SaturationState,
  type WidthState,
} from './audio/state';

// Re-export for existing consumers (PreviewTools, route) that import these from
// useAudioGraph. Single source of truth now lives in audio/state.ts.
export {
  EQ_BANDS_DEFAULT,
  COMPRESSOR_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
} from './audio/state';
export type { EqBand, CompressorState, SaturationState, WidthState } from './audio/state';

// Web Audio chain that wraps the page's single <audio> element:
//   source → eq(8 biquads) → compressor → makeupGain → satWet/satDry mix →
//   channelSplitter → (mid/side matrix via gain ops) → channelMerger →
//   analyserMain (FFT) + analyserL/analyserR (time-domain for scope) →
//   destination
//
// We build the entire graph up front and keep it always connected. Toggling
// a tool "off" means setting its parameters to identity values (eq gain 0,
// comp ratio 1 + threshold 0, sat curve linear, width 1, gain 1). This
// avoids the audio glitches that come with disconnect/reconnect during
// playback.
//
// AudioContext is created LAZILY on first call to `ensureContext()` because
// browsers block context creation outside a user gesture (Chrome/Safari).
// Call ensureContext() from a click handler before doing anything else.

export interface AudioGraphHandle {
  ensureContext: () => AudioContext;
  context: AudioContext | null;

  // Tool param setters — mutate underlying AudioParam.value directly.
  setEqBand: (index: number, gainDb: number) => void;
  setEqEnabled: (enabled: boolean) => void;

  setCompressor: (state: Partial<CompressorState>) => void;

  setSaturation: (state: Partial<SaturationState>) => void;

  setWidth: (state: Partial<WidthState>) => void;

  setMasterBypass: (bypassed: boolean) => void;
  resetAll: () => void;

  // Pitch mode — tempo-safe pitch shift via AudioBufferSourceNode.detune.
  // Streaming MediaElementSource can't detune, so the first time pitch is
  // enabled we fetch + decode the whole file into an AudioBuffer (cached).
  // The chain entry then swaps from MediaElementSource → AudioBufferSource.
  enterPitchMode: (audioUrl: string, fromSeconds: number) => Promise<void>;
  exitPitchMode: () => number; // returns current position so caller can resume MediaElement
  setPitchDetune: (semitones: number, cents: number) => void;
  pitchPause: () => void;
  pitchResume: () => void;
  pitchSeek: (positionSec: number) => void;
  pitchCurrentTime: () => number;
  pitchDuration: () => number;
  pitchPlaying: () => boolean;
  pitchSubscribe: (cb: PitchListener) => () => void;

  // Visualization snapshots (returned by readFrame()).
  // Caller drives the rAF loop; the hook only exposes data accessors.
  readFrame: () => AudioFrame;
}

export interface AudioFrame {
  /** Linear 0..1 normalized FFT amplitudes, one per band. */
  fftBins: Float32Array;
  /** Linear 0..1 normalized averages by perceptual band (8 bands). */
  bandAverages: Float32Array;
  /** RMS level over the last window, dBFS. */
  rmsDb: number;
  /** Approximated short-term LUFS (RMS + K-weighted offset). */
  lufsShort: number;
  /** Approximated true peak in dBTP (max sample over window). */
  truePeakDb: number;
  /** Pearson correlation of L vs R buffers, −1..1. */
  correlation: number;
  /** Time-domain buffers for the scope (Lissajous). */
  scopeL: Float32Array;
  scopeR: Float32Array;
}

export interface PitchState {
  semitones: number; // -12..12
  cents: number; // -50..50
  enabled: boolean;
}

export const PITCH_DEFAULT: PitchState = {
  semitones: 0,
  cents: 0,
  enabled: false,
};

// Listener types for transport events when a BufferSource is driving playback.
type PitchListener = (event: PitchEvent) => void;

export type PitchEvent =
  | { type: 'decode-start' }
  | { type: 'decode-progress'; bytesLoaded: number; bytesTotal: number }
  | { type: 'decode-complete'; durationSec: number }
  | { type: 'decode-error'; message: string }
  | { type: 'mode-enter'; positionSec: number }
  | { type: 'mode-exit'; positionSec: number }
  | { type: 'tick'; positionSec: number };

interface Nodes {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  eqFilters: BiquadFilterNode[];
  compressor: DynamicsCompressorNode;
  makeup: GainNode;
  // Saturation: parallel dry+wet
  satIn: GainNode;
  satDry: GainNode;
  satWet: GainNode;
  satShaper: WaveShaperNode;
  satMix: GainNode;
  // Width: split → midGain + sideGain via matrixed gain pairs → merge
  widthSplitter: ChannelSplitterNode;
  widthMidL: GainNode;
  widthMidR: GainNode;
  widthSideL: GainNode;
  widthSideR: GainNode;
  widthMerger: ChannelMergerNode;
  // Master bypass: dry passthrough lane + processed lane
  masterIn: GainNode;
  masterDry: GainNode;
  masterProcessed: GainNode;
  masterOut: GainNode;
  // Analysis
  analyserMain: AnalyserNode;
  scopeSplitter: ChannelSplitterNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
}

// Tanh saturation curve generator. drive 0 → linear y=x. drive 1 → strong
// tanh(3x) compression. Plotted in 1024 samples between -1..1.
function makeSatCurve(drive: number): Float32Array {
  const n = 1024;
  const out = new Float32Array(n);
  const k = 1 + drive * 4;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    out[i] = Math.tanh(k * x) / norm;
  }
  return out;
}

const FFT_SIZE = 2048;
const BAND_COUNT = 8;
// Logarithmic-ish band edges that roughly match the mockup's 8-band display
// (sub / bass / lo-mid / mid / hi-mid / pres / bril / air).
const BAND_EDGES_HZ = [20, 80, 250, 500, 1500, 4000, 8000, 12000, 20000];

export function useAudioGraph(
  // Accept a RefObject (not the resolved element) so the hook can read
  // audioElRef.current lazily at ensureContext time. Ref identity is stable
  // across renders even though .current updates when the <audio> mounts.
  // Taking the element directly would close over `null` on first render and
  // never recover (the returned handle is memoized with empty deps).
  audioElRef: RefObject<HTMLAudioElement | null>,
): AudioGraphHandle {
  const nodesRef = useRef<Nodes | null>(null);
  const eqStateRef = useRef<EqBand[]>(EQ_BANDS_DEFAULT.map((b) => ({ ...b })));
  const compStateRef = useRef<CompressorState>({ ...COMPRESSOR_DEFAULT });
  const satStateRef = useRef<SaturationState>({ ...SATURATION_DEFAULT });
  const widthStateRef = useRef<WidthState>({ ...WIDTH_DEFAULT });
  const masterBypassRef = useRef(false);
  // ── Pitch (BufferSource) lane ──
  const pitchStateRef = useRef<PitchState>({ ...PITCH_DEFAULT });
  const pitchBufferRef = useRef<AudioBuffer | null>(null);
  const pitchSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const pitchListenersRef = useRef<Set<PitchListener>>(new Set());
  const pitchStartedAtRef = useRef(0); // ctx.currentTime when start()
  const pitchOffsetRef = useRef(0); // buffer offset when start()
  const pitchPlayingRef = useRef(false);
  const pitchPausedAtRef = useRef(-1); // -1 = playing or never started
  // Scratch buffers reused per frame — never reallocate.
  const fftBytesRef = useRef<Uint8Array>(new Uint8Array(FFT_SIZE / 2));
  const fftFloatsRef = useRef<Float32Array>(new Float32Array(FFT_SIZE / 2));
  const bandAvgRef = useRef<Float32Array>(new Float32Array(BAND_COUNT));
  const scopeLRef = useRef<Float32Array>(new Float32Array(FFT_SIZE));
  const scopeRRef = useRef<Float32Array>(new Float32Array(FFT_SIZE));

  // Force re-render when context is created so consumers can re-evaluate.
  const [, setContextTick] = useState(0);

  const buildGraph = (el: HTMLAudioElement): Nodes => {
    const AC: typeof AudioContext =
      (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new AC();

    const source = ctx.createMediaElementSource(el);

    // ── EQ chain ──
    const eqFilters = EQ_BANDS_DEFAULT.map((band) => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = band.freq;
      f.Q.value = 1.4;
      f.gain.value = 0;
      return f;
    });

    // ── Compressor + makeup ──
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = COMPRESSOR_DEFAULT.thresholdDb;
    compressor.ratio.value = COMPRESSOR_DEFAULT.ratio;
    compressor.attack.value = COMPRESSOR_DEFAULT.attackMs / 1000;
    compressor.release.value = COMPRESSOR_DEFAULT.releaseMs / 1000;
    compressor.knee.value = COMPRESSOR_DEFAULT.kneeDb;
    const makeup = ctx.createGain();
    makeup.gain.value = 1;

    // ── Saturation (parallel dry+wet) ──
    const satIn = ctx.createGain();
    const satDry = ctx.createGain();
    const satWet = ctx.createGain();
    const satShaper = ctx.createWaveShaper();
    satShaper.curve = makeSatCurve(0);
    satShaper.oversample = '2x';
    const satMix = ctx.createGain();
    satDry.gain.value = 1;
    satWet.gain.value = 0;

    // ── Width (M/S matrix using channel-level gains) ──
    // ChannelSplitter → 4 gain nodes form L→M, R→M, L→S, R→S contributions.
    // Then 4 more gains form M→L, M→R, S→L, -S→R contributions, summed via
    // ChannelMerger. width param scales the side contribution.
    const widthSplitter = ctx.createChannelSplitter(2);
    const widthMidL = ctx.createGain();
    const widthMidR = ctx.createGain();
    const widthSideL = ctx.createGain();
    const widthSideR = ctx.createGain();
    const widthMerger = ctx.createChannelMerger(2);
    widthMidL.gain.value = 0.5;
    widthMidR.gain.value = 0.5;
    widthSideL.gain.value = 0.5;
    widthSideR.gain.value = -0.5;

    // ── Master bypass: dry passthrough lane vs processed lane ──
    const masterIn = ctx.createGain();
    const masterDry = ctx.createGain();
    const masterProcessed = ctx.createGain();
    const masterOut = ctx.createGain();
    masterDry.gain.value = 0;
    masterProcessed.gain.value = 1;

    // ── Analysis ──
    const analyserMain = ctx.createAnalyser();
    analyserMain.fftSize = FFT_SIZE;
    analyserMain.smoothingTimeConstant = 0.6;
    const scopeSplitter = ctx.createChannelSplitter(2);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = FFT_SIZE;
    analyserR.fftSize = FFT_SIZE;
    analyserL.smoothingTimeConstant = 0;
    analyserR.smoothingTimeConstant = 0;

    // ── Wire everything ──
    // source → masterIn → (dry passthrough) → masterOut
    //                  → (eq chain → comp → makeup → satIn → satMix
    //                     → widthMerger via matrix → masterProcessed) → masterOut
    // masterOut → analyserMain → scopeSplitter → analyserL/R → destination
    source.connect(masterIn);

    // Dry passthrough lane
    masterIn.connect(masterDry).connect(masterOut);

    // Processed lane
    let head: AudioNode = masterIn;
    for (const f of eqFilters) {
      head.connect(f);
      head = f;
    }
    head.connect(compressor).connect(makeup).connect(satIn);

    // Sat parallel split
    satIn.connect(satDry).connect(satMix);
    satIn.connect(satShaper).connect(satWet).connect(satMix);

    // Width M/S matrix.
    //   merger.input(0) [L_out] = L_in * widthMidL.gain  +  R_in * widthSideL.gain
    //   merger.input(1) [R_out] = L_in * widthMidR.gain  +  R_in * widthSideR.gain
    //
    // At width=1 (identity): widthMidL=1, widthSideL=0, widthMidR=0, widthSideR=1
    // At width=0 (mono):     all = 0.5
    // At width=2 (wide):     widthMidL=1.5, widthSideL=-0.5, widthMidR=-0.5, widthSideR=1.5
    //
    // applyWidth() owns the formulas; here we just wire the topology and set
    // identity defaults.
    satMix.connect(widthSplitter);
    widthSplitter.connect(widthMidL, 0); // L_in → widthMidL → merger L (output 0)
    widthSplitter.connect(widthSideL, 1); // R_in → widthSideL → merger L (output 0)
    widthSplitter.connect(widthMidR, 0); // L_in → widthMidR → merger R (output 1)
    widthSplitter.connect(widthSideR, 1); // R_in → widthSideR → merger R (output 1)
    widthMidL.connect(widthMerger, 0, 0);
    widthSideL.connect(widthMerger, 0, 0);
    widthMidR.connect(widthMerger, 0, 1);
    widthSideR.connect(widthMerger, 0, 1);
    widthMidL.gain.value = 1;
    widthMidR.gain.value = 0;
    widthSideL.gain.value = 0;
    widthSideR.gain.value = 1;

    widthMerger.connect(masterProcessed).connect(masterOut);

    // Master out → analyser chain → destination
    masterOut.connect(analyserMain);
    analyserMain.connect(scopeSplitter);
    scopeSplitter.connect(analyserL, 0);
    scopeSplitter.connect(analyserR, 1);
    masterOut.connect(ctx.destination);

    return {
      ctx,
      source,
      eqFilters,
      compressor,
      makeup,
      satIn,
      satDry,
      satWet,
      satShaper,
      satMix,
      widthSplitter,
      widthMidL,
      widthMidR,
      widthSideL,
      widthSideR,
      widthMerger,
      masterIn,
      masterDry,
      masterProcessed,
      masterOut,
      analyserMain,
      scopeSplitter,
      analyserL,
      analyserR,
    };
  };

  // Helper to apply current ref state to running node params.
  const applyWidth = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    const w = widthStateRef.current.enabled ? widthStateRef.current.width : 1;
    nodes.widthMidL.gain.value = 0.5 + 0.5 * w;
    nodes.widthMidR.gain.value = 0.5 - 0.5 * w;
    nodes.widthSideL.gain.value = 0.5 - 0.5 * w;
    nodes.widthSideR.gain.value = 0.5 + 0.5 * w;
  };

  const applyCompressor = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    const c = compStateRef.current;
    const effective: CompressorState = c.enabled
      ? c
      : { ...c, thresholdDb: 0, ratio: 1, makeupDb: 0 };
    nodes.compressor.threshold.value = effective.thresholdDb;
    nodes.compressor.ratio.value = effective.ratio;
    nodes.compressor.attack.value = effective.attackMs / 1000;
    nodes.compressor.release.value = effective.releaseMs / 1000;
    nodes.compressor.knee.value = effective.kneeDb;
    nodes.makeup.gain.value = Math.pow(10, effective.makeupDb / 20);
  };

  const applySaturation = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    const s = satStateRef.current;
    const drive = s.enabled ? s.drive : 0;
    const wet = s.enabled ? s.mix : 0;
    nodes.satShaper.curve = makeSatCurve(drive);
    nodes.satDry.gain.value = 1 - wet;
    nodes.satWet.gain.value = wet;
  };

  const applyEq = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    const bands = eqStateRef.current;
    for (let i = 0; i < nodes.eqFilters.length; i += 1) {
      nodes.eqFilters[i].gain.value = bands[i]?.gainDb ?? 0;
    }
  };

  const applyMasterBypass = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.masterDry.gain.value = masterBypassRef.current ? 1 : 0;
    nodes.masterProcessed.gain.value = masterBypassRef.current ? 0 : 1;
  };

  // Tear down on unmount so AudioContext is released (browsers cap to ~6).
  // Refs are captured eagerly so the cleanup uses the values that existed
  // when the effect ran, not whatever they've become at cleanup time.
  const cleanupRef = useRef<() => void>(() => undefined);
  cleanupRef.current = () => {
    const nodes = nodesRef.current;
    const pitchSrc = pitchSourceRef.current;
    const listeners = pitchListenersRef.current;
    if (pitchSrc) {
      try {
        pitchSrc.onended = null;
        pitchSrc.stop();
      } catch {
        /* already stopped */
      }
      try {
        pitchSrc.disconnect();
      } catch {
        /* already disconnected */
      }
      pitchSourceRef.current = null;
    }
    pitchBufferRef.current = null;
    listeners.clear();
    if (nodes) {
      try {
        nodes.source.disconnect();
      } catch {
        /* already disconnected */
      }
      void nodes.ctx.close();
      nodesRef.current = null;
    }
  };
  useEffect(() => () => cleanupRef.current(), []);

  const ensureContext = (): AudioContext => {
    if (nodesRef.current) {
      // If suspended (autoplay policy), resume on caller's behalf.
      if (nodesRef.current.ctx.state === 'suspended') {
        void nodesRef.current.ctx.resume();
      }
      return nodesRef.current.ctx;
    }
    const el = audioElRef.current;
    if (!el) {
      throw new Error('ensureContext called before <audio> element mounted');
    }
    const nodes = buildGraph(el);
    nodesRef.current = nodes;
    setContextTick((t) => t + 1);
    return nodes.ctx;
  };

  // Frame reader — owns the FFT byte/float scratch buffers, computes
  // band averages + correlation + RMS in one pass for the rAF loop.
  const readFrame = (): AudioFrame => {
    const nodes = nodesRef.current;
    if (!nodes) {
      return EMPTY_FRAME;
    }
    const fftBytes = fftBytesRef.current;
    const fftFloats = fftFloatsRef.current;
    const bandAvg = bandAvgRef.current;
    const scopeL = scopeLRef.current;
    const scopeR = scopeRRef.current;

    nodes.analyserMain.getByteFrequencyData(fftBytes);
    for (let i = 0; i < fftBytes.length; i += 1) {
      fftFloats[i] = fftBytes[i] / 255;
    }
    nodes.analyserL.getFloatTimeDomainData(scopeL);
    nodes.analyserR.getFloatTimeDomainData(scopeR);

    // Band averages
    const sr = nodes.ctx.sampleRate;
    const binHz = sr / FFT_SIZE;
    for (let b = 0; b < BAND_COUNT; b += 1) {
      const lo = Math.max(1, Math.floor(BAND_EDGES_HZ[b] / binHz));
      const hi = Math.min(fftFloats.length - 1, Math.ceil(BAND_EDGES_HZ[b + 1] / binHz));
      let sum = 0;
      let n = 0;
      for (let i = lo; i <= hi; i += 1) {
        sum += fftFloats[i];
        n += 1;
      }
      bandAvg[b] = n > 0 ? sum / n : 0;
    }

    // RMS + true peak from L channel (cheaper; mono approximation OK for v1).
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < scopeL.length; i += 1) {
      const v = scopeL[i];
      sumSq += v * v;
      const av = Math.abs(v);
      if (av > peak) peak = av;
    }
    const rmsLinear = Math.sqrt(sumSq / scopeL.length);
    const rmsDb = rmsLinear > 0 ? 20 * Math.log10(rmsLinear) : -120;
    const truePeakDb = peak > 0 ? 20 * Math.log10(peak) : -120;
    // K-weighted LUFS approximation — flat RMS minus a fixed ~0.691 dB
    // offset for the reference 1kHz sine. Not BS.1770-compliant but tracks
    // perceived loudness movements over time well enough for a meter UI.
    const lufsShort = rmsDb - 0.691;

    // Pearson correlation L vs R over the time-domain window
    let meanL = 0;
    let meanR = 0;
    for (let i = 0; i < scopeL.length; i += 1) {
      meanL += scopeL[i];
      meanR += scopeR[i];
    }
    meanL /= scopeL.length;
    meanR /= scopeR.length;
    let num = 0;
    let denL = 0;
    let denR = 0;
    for (let i = 0; i < scopeL.length; i += 1) {
      const dl = scopeL[i] - meanL;
      const dr = scopeR[i] - meanR;
      num += dl * dr;
      denL += dl * dl;
      denR += dr * dr;
    }
    const denom = Math.sqrt(denL * denR);
    const correlation = denom > 1e-9 ? num / denom : 0;

    return {
      fftBins: fftFloats,
      bandAverages: bandAvg,
      rmsDb,
      lufsShort,
      truePeakDb,
      correlation,
      scopeL,
      scopeR,
    };
  };

  // ── Pitch lane: tempo-safe pitch shift via AudioBufferSource.detune ──
  // Note: in vanilla Web Audio, detune scales playbackRate (computedRate =
  // playbackRate * pow(2, detune/1200)). So pitch up → tempo up too. True
  // tempo-safe pitch shift requires an AudioWorklet phase vocoder; that's a
  // future upgrade. For now the UX matches the v1 implementation.

  const emitPitch = (event: PitchEvent) => {
    for (const cb of pitchListenersRef.current) cb(event);
  };

  const decodePitchBuffer = async (audioUrl: string): Promise<AudioBuffer> => {
    if (pitchBufferRef.current) return pitchBufferRef.current;
    const nodes = nodesRef.current;
    if (!nodes) throw new Error('AudioContext not initialized — call ensureContext first');
    emitPitch({ type: 'decode-start' });
    try {
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      const decoded = await nodes.ctx.decodeAudioData(ab);
      pitchBufferRef.current = decoded;
      emitPitch({ type: 'decode-complete', durationSec: decoded.duration });
      return decoded;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitPitch({ type: 'decode-error', message });
      throw err;
    }
  };

  const createPitchSource = (buffer: AudioBuffer, offsetSec: number) => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    const src = nodes.ctx.createBufferSource();
    src.buffer = buffer;
    src.detune.value =
      pitchStateRef.current.semitones * 100 + pitchStateRef.current.cents;
    src.connect(nodes.masterIn);
    src.onended = () => {
      // Web Audio also fires onended when we explicitly stop(); guard so
      // an explicit stop doesn't reset our paused-position bookkeeping.
      if (pitchSourceRef.current === src) {
        pitchSourceRef.current = null;
        pitchPlayingRef.current = false;
        if (pitchPausedAtRef.current < 0) {
          pitchPausedAtRef.current = buffer.duration;
        }
      }
    };
    src.start(0, Math.max(0, Math.min(buffer.duration, offsetSec)));
    pitchSourceRef.current = src;
    pitchStartedAtRef.current = nodes.ctx.currentTime;
    pitchOffsetRef.current = offsetSec;
    pitchPlayingRef.current = true;
    pitchPausedAtRef.current = -1;
  };

  const stopCurrentPitchSource = (): number => {
    const nodes = nodesRef.current;
    if (!nodes) return 0;
    if (!pitchSourceRef.current) {
      return pitchPausedAtRef.current >= 0
        ? pitchPausedAtRef.current
        : pitchOffsetRef.current;
    }
    const pos =
      nodes.ctx.currentTime - pitchStartedAtRef.current + pitchOffsetRef.current;
    try {
      pitchSourceRef.current.onended = null;
      pitchSourceRef.current.stop();
    } catch {
      /* already stopped */
    }
    try {
      pitchSourceRef.current.disconnect();
    } catch {
      /* already disconnected */
    }
    pitchSourceRef.current = null;
    pitchPlayingRef.current = false;
    return pos;
  };

  // Stable handle — all methods close over refs only, so identity can be
  // frozen at first render. Without this, every parent re-render produces a
  // fresh handle and any `[graph]`-dep effect re-fires (notably the pitch
  // mode entry effect, which would kick off duplicate enterPitchMode calls
  // mid-decode).
  return useMemo<AudioGraphHandle>(() => ({
    get context() {
      return nodesRef.current?.ctx ?? null;
    },
    ensureContext,
    setEqBand: (index, gainDb) => {
      const bands = eqStateRef.current;
      if (bands[index]) bands[index].gainDb = gainDb;
      applyEq();
    },
    setEqEnabled: (enabled) => {
      const bands = eqStateRef.current;
      if (!enabled) {
        for (const b of bands) b.gainDb = 0;
      }
      applyEq();
    },
    setCompressor: (patch) => {
      Object.assign(compStateRef.current, patch);
      applyCompressor();
    },
    setSaturation: (patch) => {
      Object.assign(satStateRef.current, patch);
      applySaturation();
    },
    setWidth: (patch) => {
      Object.assign(widthStateRef.current, patch);
      applyWidth();
    },
    setMasterBypass: (bypassed) => {
      masterBypassRef.current = bypassed;
      applyMasterBypass();
    },
    resetAll: () => {
      eqStateRef.current = EQ_BANDS_DEFAULT.map((b) => ({ ...b }));
      compStateRef.current = { ...COMPRESSOR_DEFAULT };
      satStateRef.current = { ...SATURATION_DEFAULT };
      widthStateRef.current = { ...WIDTH_DEFAULT };
      masterBypassRef.current = false;
      applyEq();
      applyCompressor();
      applySaturation();
      applyWidth();
      applyMasterBypass();
    },
    enterPitchMode: async (audioUrl, fromSeconds) => {
      ensureContext();
      // decodePitchBuffer caches the result on pitchBufferRef; we just await
      // it for the side effect + completion timing.
      await decodePitchBuffer(audioUrl);
      const nodes = nodesRef.current;
      if (!nodes) return;
      // Disconnect MediaElementSource so the audio element stops feeding the
      // chain. The <audio> tag itself is paused by the caller before we
      // enter pitch mode.
      try {
        nodes.source.disconnect(nodes.masterIn);
      } catch {
        /* already disconnected */
      }
      pitchStateRef.current.enabled = true;
      pitchPausedAtRef.current = fromSeconds;
      pitchOffsetRef.current = fromSeconds;
      emitPitch({ type: 'mode-enter', positionSec: fromSeconds });
    },
    exitPitchMode: () => {
      const pos = stopCurrentPitchSource();
      const nodes = nodesRef.current;
      if (nodes) {
        try {
          nodes.source.connect(nodes.masterIn);
        } catch {
          /* already connected */
        }
      }
      pitchStateRef.current.enabled = false;
      pitchPausedAtRef.current = -1;
      pitchOffsetRef.current = 0;
      emitPitch({ type: 'mode-exit', positionSec: pos });
      return pos;
    },
    setPitchDetune: (semitones, cents) => {
      pitchStateRef.current.semitones = semitones;
      pitchStateRef.current.cents = cents;
      if (pitchSourceRef.current) {
        pitchSourceRef.current.detune.value = semitones * 100 + cents;
      }
    },
    pitchPause: () => {
      const pos = stopCurrentPitchSource();
      pitchPausedAtRef.current = pos;
    },
    pitchResume: () => {
      if (!pitchBufferRef.current) return;
      if (pitchSourceRef.current) return; // already playing
      const at =
        pitchPausedAtRef.current >= 0
          ? pitchPausedAtRef.current
          : pitchOffsetRef.current;
      createPitchSource(pitchBufferRef.current, at);
    },
    pitchSeek: (positionSec) => {
      if (!pitchBufferRef.current) return;
      const wasPlaying = pitchPlayingRef.current;
      stopCurrentPitchSource();
      const target = Math.max(
        0,
        Math.min(pitchBufferRef.current.duration, positionSec),
      );
      if (wasPlaying) {
        createPitchSource(pitchBufferRef.current, target);
      } else {
        pitchPausedAtRef.current = target;
        pitchOffsetRef.current = target;
      }
    },
    pitchCurrentTime: () => {
      const nodes = nodesRef.current;
      if (!nodes) return 0;
      if (pitchSourceRef.current && pitchPlayingRef.current) {
        return (
          nodes.ctx.currentTime - pitchStartedAtRef.current + pitchOffsetRef.current
        );
      }
      return pitchPausedAtRef.current >= 0
        ? pitchPausedAtRef.current
        : pitchOffsetRef.current;
    },
    pitchDuration: () => pitchBufferRef.current?.duration ?? 0,
    pitchPlaying: () => pitchPlayingRef.current,
    pitchSubscribe: (cb) => {
      pitchListenersRef.current.add(cb);
      return () => {
        pitchListenersRef.current.delete(cb);
      };
    },
    readFrame,
    // The closures captured here only read from refs, never from React state,
    // so re-evaluating them on every render would be wasted work and (worse)
    // would invalidate any consumer's `[graph]`-dep effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
}

const EMPTY_FRAME: AudioFrame = {
  fftBins: new Float32Array(0),
  bandAverages: new Float32Array(8),
  rmsDb: -120,
  lufsShort: -120,
  truePeakDb: -120,
  correlation: 0,
  scopeL: new Float32Array(0),
  scopeR: new Float32Array(0),
};

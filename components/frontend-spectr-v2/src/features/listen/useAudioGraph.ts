import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { buildInsertChain, type DeviceIoLevels, type InsertChain } from './audio/composer';
import { createPitchLane, type PitchLane } from './audio/pitchLane';
import type { EffectId, EffectMeter } from './audio/EffectUnit';
import {
  DEFAULT_ORDER,
  EQ_BANDS_DEFAULT,
  COMPRESSOR_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
  DJFILTER_DEFAULT,
  DELAY_DEFAULT,
  REVERB_DEFAULT,
  PAN_DEFAULT,
  TREMOLO_DEFAULT,
  TRIM_DEFAULT,
  GATE_DEFAULT,
  BITCRUSHER_DEFAULT,
  LIMITER_DEFAULT,
  type EqBand,
  type CompressorState,
  type SaturationState,
  type WidthState,
  type DjFilterState,
  type DelayState,
  type ReverbState,
  type PanState,
  type TremoloState,
  type TrimState,
  type GateState,
  type BitcrusherState,
  type LimiterState,
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

export interface EffectParamMap {
  eq: { bands: EqBand[]; enabled: boolean };
  comp: CompressorState;
  sat: SaturationState;
  ms: WidthState;
  djfilter: DjFilterState;
  delay: DelayState;
  reverb: ReverbState;
  pan: PanState;
  tremolo: TremoloState;
  trim: TrimState;
  gate: GateState;
  bitcrusher: BitcrusherState;
  limiter: LimiterState;
}

// Web Audio chain that wraps the page's single <audio> element. The processing
// graph is composed from modular EffectUnits (see audio/composer.ts):
//   source → masterIn → masterDry ───────────────────────────────→ masterOut   (bypass lane)
//                     → insert chain: EQ → Comp → Sat → M/S        → masterOut
//                       (buildInsertChain; each unit owns a dry/wet bypass)
//   masterOut → analyserMain (FFT) + analyserL/analyserR (scope) → destination
//
// Per-unit dry/wet bypass (audio/EffectUnit.ts makeDryWet) means a unit "off" is
// wet=0 (true dry passthrough), not identity param values. The pitch BufferSource
// lane and the master-bypass passthrough live OUTSIDE the insert chain.
//
// AudioContext is created LAZILY on first ensureContext() because browsers block
// context creation outside a user gesture (Chrome/Safari). Call ensureContext()
// from a click handler before doing anything else.

export interface AudioGraphHandle {
  ensureContext: () => AudioContext;
  context: AudioContext | null;

  // Tool param setters — mutate underlying AudioParam.value directly.
  setEqBand: (index: number, gainDb: number) => void;
  setEqEnabled: (enabled: boolean) => void;

  setCompressor: (state: Partial<CompressorState>) => void;

  setSaturation: (state: Partial<SaturationState>) => void;

  setWidth: (state: Partial<WidthState>) => void;

  setEffectParams: <K extends EffectId>(id: K, patch: Partial<EffectParamMap[K]>) => void;
  reorder: (order: EffectId[]) => void;
  getOrder: () => EffectId[];
  readEffectMeter: (id: EffectId) => EffectMeter | null;
  // Device I/O metering: roaming analyser taps on one unit's input/output
  // (the device bay's IN/OUT bars). No-ops until the AudioContext exists.
  tapDeviceIo: (id: EffectId | null) => void;
  readDeviceIo: () => DeviceIoLevels | null;

  setMasterBypass: (bypassed: boolean) => void;
  getMasterBypass: () => boolean;
  resetAll: () => void;

  // ── Pitch lane (CURRENT) — constant-tempo shift in an AudioWorklet at the
  // end of the master path. Pitch and tempo are independent: pass the media
  // element's playbackRate and the lane divides it back out.
  setPitchShift: (semitones: number, cents: number, playbackRate: number) => void;
  setPitchShiftEnabled: (on: boolean) => void;

  // ── LEGACY buffer lane (no longer used by the rack; kept for the transport
  // API surface). Pitch here rides AudioBufferSourceNode.detune, which COUPLES
  // pitch and tempo — that coupling is exactly why the worklet lane above
  // replaced it. Slated for removal.
  // Streaming MediaElementSource can't detune, so the first time pitch is
  // enabled we fetch + decode the whole file into an AudioBuffer (cached).
  // The chain entry then swaps from MediaElementSource → AudioBufferSource.
  enterPitchMode: (audioUrl: string, fromSeconds: number) => Promise<void>;
  exitPitchMode: () => number; // returns current position so caller can resume MediaElement
  setPitchDetune: (semitones: number, cents: number) => void;
  // Tempo multiplier for the pitch lane (buffer playbackRate). Lets the user
  // compensate detune's speed coupling: +5 st ≈ ×1.335 speed, so tempo ≈ 0.75
  // restores original speed at the shifted pitch.
  setPitchRate: (rate: number) => void;
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
  rate: number; // 0.2..5 — buffer playbackRate (tempo knob)
  enabled: boolean;
}

export const PITCH_DEFAULT: PitchState = {
  semitones: 0,
  cents: 0,
  rate: 1,
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
  chain: InsertChain;
  pitch: PitchLane;
  masterIn: GainNode;
  masterDry: GainNode;
  masterProcessed: GainNode;
  masterOut: GainNode;
  analyserMain: AnalyserNode;
  scopeSplitter: ChannelSplitterNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
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
  const eqEnabledRef = useRef(true);
  const compStateRef = useRef<CompressorState>({ ...COMPRESSOR_DEFAULT });
  const satStateRef = useRef<SaturationState>({ ...SATURATION_DEFAULT });
  const widthStateRef = useRef<WidthState>({ ...WIDTH_DEFAULT });
  const djFilterStateRef = useRef<DjFilterState>({ ...DJFILTER_DEFAULT });
  const delayStateRef = useRef<DelayState>({ ...DELAY_DEFAULT });
  const reverbStateRef = useRef<ReverbState>({ ...REVERB_DEFAULT });
  const panStateRef = useRef<PanState>({ ...PAN_DEFAULT });
  const tremoloStateRef = useRef<TremoloState>({ ...TREMOLO_DEFAULT });
  const trimStateRef = useRef<TrimState>({ ...TRIM_DEFAULT });
  const gateStateRef = useRef<GateState>({ ...GATE_DEFAULT });
  const bitcrusherStateRef = useRef<BitcrusherState>({ ...BITCRUSHER_DEFAULT });
  const limiterStateRef = useRef<LimiterState>({ ...LIMITER_DEFAULT });
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

    const chain = buildInsertChain(ctx);

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
    source.connect(masterIn);

    // Dry passthrough lane (master bypass) — unchanged.
    masterIn.connect(masterDry).connect(masterOut);
    // Processed lane now runs through the composed insert chain.
    masterIn.connect(chain.chainIn);
    chain.chainOut.connect(masterProcessed).connect(masterOut);

    masterOut.connect(analyserMain);
    analyserMain.connect(scopeSplitter);
    scopeSplitter.connect(analyserL, 0);
    scopeSplitter.connect(analyserR, 1);
    // Pitch lane sits LAST (after the meters, before the speakers): a
    // constant-tempo shifter, dry until the rack's pitch device is enabled.
    const pitch = createPitchLane(ctx);
    masterOut.connect(pitch.input);
    pitch.output.connect(ctx.destination);
    void chain.ready.then(() => pitch.materialize());

    return {
      ctx,
      source,
      chain,
      pitch,
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
    nodes.chain.units.ms.applyParams(widthStateRef.current);
  };

  const applyCompressor = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.comp.applyParams(compStateRef.current);
  };

  const applySaturation = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.sat.applyParams(satStateRef.current);
  };

  const applyEq = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.eq.applyParams({ bands: eqStateRef.current, enabled: eqEnabledRef.current });
  };

  const applyDjFilter = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.djfilter.applyParams(djFilterStateRef.current);
  };

  const applyDelay = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.delay.applyParams(delayStateRef.current);
  };

  const applyReverb = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.reverb.applyParams(reverbStateRef.current);
  };

  const applyPan = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.pan.applyParams(panStateRef.current);
  };

  const applyTremolo = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.tremolo.applyParams(tremoloStateRef.current);
  };

  const applyTrim = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.trim.applyParams(trimStateRef.current);
  };

  const applyGate = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.gate.applyParams(gateStateRef.current);
  };

  const applyBitcrusher = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.bitcrusher.applyParams(bitcrusherStateRef.current);
  };

  const applyLimiter = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.limiter.applyParams(limiterStateRef.current);
  };

  const applyMasterBypass = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.masterDry.gain.value = masterBypassRef.current ? 1 : 0;
    nodes.masterProcessed.gain.value = masterBypassRef.current ? 0 : 1;
  };

  const applyEffectParams = <K extends EffectId>(
    id: K,
    patch: Partial<EffectParamMap[K]>,
  ): void => {
    switch (id) {
      case 'eq': {
        const p = patch as Partial<EffectParamMap['eq']>;
        if (p.bands) eqStateRef.current = p.bands;
        if (p.enabled !== undefined) eqEnabledRef.current = p.enabled;
        applyEq();
        break;
      }
      case 'comp':
        Object.assign(compStateRef.current, patch);
        applyCompressor();
        break;
      case 'sat':
        Object.assign(satStateRef.current, patch);
        applySaturation();
        break;
      case 'ms':
        Object.assign(widthStateRef.current, patch);
        applyWidth();
        break;
      case 'djfilter':
        Object.assign(djFilterStateRef.current, patch);
        applyDjFilter();
        break;
      case 'delay':
        Object.assign(delayStateRef.current, patch);
        applyDelay();
        break;
      case 'reverb':
        Object.assign(reverbStateRef.current, patch);
        applyReverb();
        break;
      case 'pan':
        Object.assign(panStateRef.current, patch);
        applyPan();
        break;
      case 'tremolo':
        Object.assign(tremoloStateRef.current, patch);
        applyTremolo();
        break;
      case 'trim':
        Object.assign(trimStateRef.current, patch);
        applyTrim();
        break;
      case 'gate':
        Object.assign(gateStateRef.current, patch);
        applyGate();
        break;
      case 'bitcrusher':
        Object.assign(bitcrusherStateRef.current, patch);
        applyBitcrusher();
        break;
      case 'limiter':
        Object.assign(limiterStateRef.current, patch);
        applyLimiter();
        break;
    }
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
      nodes.chain.dispose();
      nodes.pitch.dispose();
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

  // ── Pitch lane: pitch shift via AudioBufferSource.detune ──
  // In vanilla Web Audio, detune scales playbackRate (computedRate =
  // playbackRate * pow(2, detune/1200)), so pitch up → tempo up too. The
  // separate rate control (setPitchRate) lets the user counter that manually
  // (e.g. +5 st at rate 0.75 ≈ original speed) — but resampled, so timbre
  // still shifts. True formant/tempo-independent pitch requires an
  // AudioWorklet phase vocoder; that's a future upgrade.

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

  // What Web Audio actually plays at: computedRate = playbackRate × 2^(detune/1200).
  // Buffer position advances at this rate per wall-clock second, so all
  // position bookkeeping must scale by it.
  const pitchComputedRate = () => {
    const st = pitchStateRef.current;
    return st.rate * Math.pow(2, (st.semitones * 100 + st.cents) / 1200);
  };

  // A rate change invalidates the wall-clock→buffer-time mapping; fold the
  // elapsed-so-far into the offset (at the OLD rate) and restart the clock
  // before the new rate takes effect.
  const reanchorPitchClock = () => {
    const nodes = nodesRef.current;
    if (!nodes || !pitchSourceRef.current || !pitchPlayingRef.current) return;
    pitchOffsetRef.current =
      (nodes.ctx.currentTime - pitchStartedAtRef.current) * pitchComputedRate() +
      pitchOffsetRef.current;
    pitchStartedAtRef.current = nodes.ctx.currentTime;
  };

  const createPitchSource = (buffer: AudioBuffer, offsetSec: number) => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    const src = nodes.ctx.createBufferSource();
    src.buffer = buffer;
    src.detune.value =
      pitchStateRef.current.semitones * 100 + pitchStateRef.current.cents;
    src.playbackRate.value = pitchStateRef.current.rate;
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
      (nodes.ctx.currentTime - pitchStartedAtRef.current) * pitchComputedRate() +
      pitchOffsetRef.current;
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
      eqEnabledRef.current = enabled;
      applyEq();
    },
    setCompressor: (patch) => applyEffectParams('comp', patch),
    setSaturation: (patch) => applyEffectParams('sat', patch),
    setWidth: (patch) => applyEffectParams('ms', patch),
    setEffectParams: (id, patch) => applyEffectParams(id, patch),
    reorder: (order) => nodesRef.current?.chain.reorder(order),
    getOrder: () => nodesRef.current?.chain.getOrder() ?? [...DEFAULT_ORDER],
    readEffectMeter: (id) => nodesRef.current?.chain.units[id]?.readMeter?.() ?? null,
    tapDeviceIo: (id) => nodesRef.current?.chain.setTap(id),
    readDeviceIo: () => nodesRef.current?.chain.readTap() ?? null,
    setPitchShift: (semitones, cents, playbackRate) =>
      nodesRef.current?.pitch.setShift(semitones, cents, playbackRate),
    setPitchShiftEnabled: (on) => nodesRef.current?.pitch.setEnabled(on),
    setMasterBypass: (bypassed) => {
      masterBypassRef.current = bypassed;
      applyMasterBypass();
    },
    getMasterBypass: () => masterBypassRef.current,
    resetAll: () => {
      eqStateRef.current = EQ_BANDS_DEFAULT.map((b) => ({ ...b }));
      eqEnabledRef.current = true;
      compStateRef.current = { ...COMPRESSOR_DEFAULT };
      satStateRef.current = { ...SATURATION_DEFAULT };
      widthStateRef.current = { ...WIDTH_DEFAULT };
      djFilterStateRef.current = { ...DJFILTER_DEFAULT };
      delayStateRef.current = { ...DELAY_DEFAULT };
      reverbStateRef.current = { ...REVERB_DEFAULT };
      panStateRef.current = { ...PAN_DEFAULT };
      tremoloStateRef.current = { ...TREMOLO_DEFAULT };
      trimStateRef.current = { ...TRIM_DEFAULT };
      gateStateRef.current = { ...GATE_DEFAULT };
      bitcrusherStateRef.current = { ...BITCRUSHER_DEFAULT };
      limiterStateRef.current = { ...LIMITER_DEFAULT };
      masterBypassRef.current = false;
      applyEq();
      applyCompressor();
      applySaturation();
      applyWidth();
      applyDjFilter();
      applyDelay();
      applyReverb();
      applyPan();
      applyTremolo();
      applyTrim();
      applyGate();
      applyBitcrusher();
      applyLimiter();
      applyMasterBypass();
      nodesRef.current?.chain.reorder([...DEFAULT_ORDER]);
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
      reanchorPitchClock();
      pitchStateRef.current.semitones = semitones;
      pitchStateRef.current.cents = cents;
      if (pitchSourceRef.current) {
        pitchSourceRef.current.detune.value = semitones * 100 + cents;
      }
    },
    setPitchRate: (rate) => {
      reanchorPitchClock();
      pitchStateRef.current.rate = rate;
      if (pitchSourceRef.current) {
        pitchSourceRef.current.playbackRate.value = rate;
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
          (nodes.ctx.currentTime - pitchStartedAtRef.current) *
            pitchComputedRate() +
          pitchOffsetRef.current
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

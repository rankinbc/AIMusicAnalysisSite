/* Listen Rack v2 — stage card: the full visualizer stage (VizStage — every
 * stage from the design's stage-select: eq/devices/radial/orbit/bloom/smoke/
 * spectro/lights/info, plus laser fan, fireworks, background flash) with
 * the design's overlay meter chips + transport lane (play, waveform scrub,
 * note pins). Real-audio route: the stage + meter chips read the live
 * AnalyserNode frame; mock demo route keeps the synthetic spectrum. */
import { useRef } from 'react';

import type { AudioFrame } from '../listen/useAudioGraph';
import { Icon } from '../results/Icon';
import type { Director, ModuleManifest, ModuleState, TrackNote, VizState } from './data';
import { StagePlacementButton } from './findings/StagePlacementButton';
import type { StageContent } from './findings/stage-prefs';
import { lrClamp, lrDrag, lrTime } from './lrUtil';
import type { LiveMeters } from './useLiveMeters';
import { VizStage } from './viz';

// ── Transport: play, waveform scrub with note pins, mono readout ────────
const LR_WAVE = Array.from({ length: 128 }, (_, i) =>
  0.2 + Math.abs(Math.sin(i * 0.31) * 0.42 + Math.sin(i * 0.09) * 0.34 + Math.sin(i * 1.7) * 0.12));

export function TransportV2({ playing, onPlay, position, duration, onSeek, notes, activeNote, onNote, showNotes, bpm, keyLabel }: {
  playing: boolean; onPlay: () => void; position: number; duration: number;
  onSeek: (t: number) => void; notes: TrackNote[]; activeNote: string | null;
  onNote: (n: TrackNote) => void; showNotes: boolean; bpm: number; keyLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dur = duration > 0 ? duration : 1;
  const pct = lrClamp(position / dur, 0, 1);
  return (
    <div className="lr-tp">
      <button type="button" className="pl-btn" onClick={onPlay} title={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <span className="pl-time"><b>{lrTime(position)}</b><span className="sep">/</span><span className="tot">{lrTime(duration)}</span></span>
      <div
        className="lr-wave"
        ref={ref}
        onPointerDown={(e) => { e.preventDefault(); if (ref.current) lrDrag(ref.current, e, (v) => onSeek(v * dur)); }}
      >
        {LR_WAVE.map((v, i) => (
          <i key={i} className={i / LR_WAVE.length <= pct ? 'on' : ''} style={{ height: v * 100 + '%' }} />
        ))}
        {showNotes && notes.map((n) => (
          <button
            type="button"
            key={n.id}
            className={'lr-note' + (n.pinned ? ' pin' : '')}
            title={n.text}
            style={{ left: (n.t / dur) * 100 + '%', outline: activeNote === n.id ? '1.5px solid #fff' : 'none' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onNote(n)}
          />
        ))}
      </div>
      <span className="pl-time"><span className="tot">{bpm > 0 ? `${bpm} BPM` : '—'}</span><span className="sep">·</span>{keyLabel}</span>
    </div>
  );
}

// ── Stage card: overlay chips + full visualizer stage + transport ──────
export function StageCardV2({ playing, onPlay, position, duration, onSeek, mod, order, bypass, meters, stageHeight, showMeters, notes, activeNote, onNote, showNotes, section, bpm, keyLabel, getFrame, viz, stages, setStages, director, activeModules, trackName, trackSub, stageContent, onStageContentChange, bgViz, onBgVizChange, findings }: {
  playing: boolean; onPlay: () => void; position: number; duration: number;
  onSeek: (t: number) => void;
  mod: Record<string, ModuleState>; order: string[]; bypass: boolean;
  meters: LiveMeters; stageHeight: number; showMeters: boolean;
  notes: TrackNote[]; activeNote: string | null; onNote: (n: TrackNote) => void;
  showNotes: boolean; section: string | null; bpm: number; keyLabel: string;
  getFrame: (() => AudioFrame) | null;
  viz: VizState;
  stages: string[];
  setStages: (v: string[]) => void;
  director: Director | undefined;
  activeModules: ModuleManifest[];
  trackName: string;
  trackSub: string;
  /** Spec D6 — what the stage box is showing. */
  stageContent: StageContent;
  onStageContentChange: (content: StageContent) => void;
  /** The visualizer is playing full-screen BEHIND the page. */
  bgViz: boolean;
  onBgVizChange: (v: boolean) => void;
  /** The findings board. Omit it (mock demo route) and the stage is the
   *  visualizer, exactly as before. */
  findings?: React.ReactNode | undefined;
}) {
  const active = order.filter((id) => mod[id]?.enabled).length;
  const showBoard = findings != null && stageContent === 'findings';
  return (
    <div className="card lr-stagecard" data-stage={showBoard ? 'findings' : 'visualizer'}>
      {showBoard ? (
        <>
          <div className="lr-findings-stage">{findings}</div>
          {/* The visualizer keeps playing behind the whole page; the card slot
              belongs to the board, so no ghost placeholder. */}
          {bgViz && (
            <VizStage
              playing={playing}
              stages={stages}
              setStages={setStages}
              viz={viz}
              director={director}
              height={stageHeight}
              compact
              activeModules={activeModules}
              trackName={trackName}
              trackSub={trackSub}
              bgMode
              onBgModeChange={onBgVizChange}
              slot="none"
              {...(getFrame ? { getFrame } : {})}
            />
          )}
          <StagePlacementButton bgMode={bgViz} onChange={onBgVizChange} context="findings" />
        </>
      ) : (
        <VizStage
          playing={playing}
          stages={stages}
          setStages={setStages}
          viz={viz}
          director={director}
          height={stageHeight}
          compact
          activeModules={activeModules}
          trackName={trackName}
          trackSub={trackSub}
          bgMode={bgViz}
          onBgModeChange={onBgVizChange}
          {...(getFrame ? { getFrame } : {})}
        />
      )}
      <div className="lr-ovl" style={{ right: 54 }}>
        {findings != null && (
          <span className="lr-seg lr-stage-seg" role="tablist" aria-label="Stage content">
            <button
              type="button"
              role="tab"
              aria-selected={showBoard}
              className={showBoard ? 'on' : ''}
              onClick={() => onStageContentChange('findings')}
            >
              Findings
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!showBoard}
              className={!showBoard ? 'on' : ''}
              onClick={() => onStageContentChange('visualizer')}
            >
              Visualizer
            </button>
          </span>
        )}
        {section && <span className="lr-mchip sec">Section <b>{section}</b></span>}
        {showMeters && (
          <>
            <span className={'lr-mchip ' + (meters.lufs > -10.5 ? 'warn' : 'ok')}>LUFS-S <b>{meters.lufs.toFixed(1)}</b></span>
            <span className={'lr-mchip ' + (meters.tp > -0.3 ? 'warn' : 'ok')}>True peak <b>{meters.tp.toFixed(1)}</b></span>
            <span className="lr-mchip">Corr <b>{meters.corr.toFixed(2)}</b></span>
            <span className={'lr-mchip ' + (meters.gr > 2.5 ? 'warn' : '')}>GR <b>−{meters.gr.toFixed(1)}</b></span>
          </>
        )}
        <span className="sp" />
        <span className="lr-mchip">Chain <b>{bypass ? 'bypassed' : active + ' on'}</b></span>
      </div>
      <TransportV2
        playing={playing}
        onPlay={onPlay}
        position={position}
        duration={duration}
        onSeek={onSeek}
        notes={notes}
        activeNote={activeNote}
        onNote={onNote}
        showNotes={showNotes}
        bpm={bpm}
        keyLabel={keyLabel}
      />
    </div>
  );
}

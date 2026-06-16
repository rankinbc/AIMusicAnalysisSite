import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as Slider from '@radix-ui/react-slider';
import type { StemEngineHandle, StemSource } from './useStemEngine';
import type { StemControl } from './stemGains';
import s from './StemDeck.module.css';

// One stem as the deck consumes it: id-keyed, with a role (for color/sub) and the
// original filename as a label fallback when the stem isn't role-classified yet.
export interface DeckStem {
  id: string;
  role: string | null;
  filename: string;
}

const ROLE_META: Record<string, { label: string; color: string; sub: string }> = {
  drums: { label: 'Drums', color: '#5eead4', sub: 'kick · hats · perc' },
  bass: { label: 'Bass', color: '#60a5fa', sub: 'sub · low end' },
  lead: { label: 'Synth Lead', color: '#fb923c', sub: 'melody' },
  pad: { label: 'Chords', color: '#a78bfa', sub: 'pads · keys' },
  vocals: { label: 'Vocal', color: '#34d399', sub: 'lead · backing' },
  fx: { label: 'FX/Atmos', color: '#94a3b8', sub: 'risers · noise' },
  kick: { label: 'Kick', color: '#5eead4', sub: 'low' },
  snare: { label: 'Snare', color: '#f472b6', sub: 'crack' },
  hats: { label: 'Hats', color: '#fbbf24', sub: 'hi-hats' },
  other: { label: 'Other', color: '#94a3b8', sub: 'misc' },
};

function prettyFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Stem';
}

// Deterministic mini-waveform bar heights (0..1) derived from the stem id, so a
// given stem always renders the same shape. Decorative — not the real waveform.
function waveBars(id: string, n = 42): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    out.push(0.18 + ((h % 1000) / 1000) * 0.82);
  }
  return out;
}

function metaFor(stem: DeckStem): { label: string; color: string; sub: string } {
  const m = stem.role ? ROLE_META[stem.role] : undefined;
  return {
    label: m?.label ?? prettyFilename(stem.filename),
    color: m?.color ?? '#94a3b8',
    sub: m?.sub ?? '',
  };
}

interface Props {
  stems: DeckStem[];
  isLoading: boolean;
  stemUrl: (stemId: string) => string;   // builds the ?t= authed URL (reads current token)
  engine: StemEngineHandle;
  playing: boolean;
  onActivate: () => void;          // pause the single-track graph (stem mode is exclusive)
  onPlayPause: (next: boolean) => void;
}

export function StemDeck({ stems, isLoading, stemUrl, engine, playing, onActivate, onPlayPause }: Props) {
  const [controls, setControls] = useState<StemControl[]>([]);

  // Mirror controls in a ref so the load effect can apply the current mix after a
  // rebuild WITHOUT depending on `controls` (which would rebuild on every fader move).
  const controlsRef = useRef<StemControl[]>(controls);
  controlsRef.current = controls;

  const idsKey = stems.map((st) => st.id).join(',');
  // Build sources every render (cheap); stemUrl reads the current token, so a token
  // rotation changes the URL set and triggers effect (2) below.
  const sources: StemSource[] = stems.map((st) => ({ id: st.id, url: stemUrl(st.id) }));
  const urlsKey = sources.map((src) => src.url).join('|');

  // index for color/sub/label lookup by id
  const metaById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof metaFor>>();
    for (const st of stems) m.set(st.id, metaFor(st));
    return m;
  }, [stems]);

  // (1) Initialize controls to defaults whenever the STEM SET changes.
  useEffect(() => {
    if (stems.length === 0) { setControls([]); return; }
    setControls(stems.map((st) => ({ id: st.id, volume: 0.8, mute: false, solo: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // (2) (Re)build the engine graph whenever the URL SET changes (stem change OR
  // token rotation → fresh ?t= URLs). Apply the current mix right after load so the
  // rebuilt gain nodes don't sit at full gain (engine inits each gain to 1).
  useEffect(() => {
    if (sources.length === 0) return;
    engine.load(sources);
    // On the very first mount controlsRef is still [] (effect 1's setState hasn't
    // committed yet), so this applies empty controls → all gains briefly 0. That's
    // inaudible because playback hasn't started; effect 3 applies the real mix on the
    // next render, well before the user can click Play.
    engine.setControls(controlsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey, engine]);

  // (3) Push control changes (fader / solo / mute) to the engine.
  useEffect(() => { engine.setControls(controls); }, [controls, engine]);

  const patch = (id: string, p: Partial<StemControl>) =>
    setControls((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const anySolo = useMemo(() => controls.some((c) => c.solo), [controls]);

  const togglePlay = async () => {
    if (playing) {
      engine.pause();
      onPlayPause(false);
      return;
    }
    onActivate();
    try {
      await engine.play();
      onPlayPause(true);
    } catch {
      toast.error('Could not start stem playback');
    }
  };

  if (isLoading) return <p className={s.empty}>Loading stems…</p>;

  if (stems.length === 0) {
    return (
      <div className={s.empty}>
        <p>No stems for this version.</p>
        <p className={s.hint}>Upload separated stems (drums, bass, vocals…) to unlock the DJ deck.</p>
      </div>
    );
  }

  const playingCount = controls.filter((c) => !c.mute && (!anySolo || c.solo)).length;

  return (
    <div className={s.deck}>
      <div className={s.deckHead}>
        <span className={s.title}>Stem deck</span>
        <button type="button" className="btn primary sm" onClick={togglePlay}>
          {playing ? 'Stop all' : 'Play all'}
        </button>
      </div>

      {controls.map((c) => {
        const meta = metaById.get(c.id) ?? { label: c.id, color: '#94a3b8', sub: '' };
        const dim = c.mute || (anySolo && !c.solo);
        return (
          <div key={c.id} className={s.stem} data-dim={dim} style={{ ['--c' as string]: meta.color }}>
            <div className={s.stemTop}>
              <div className={s.stemName}>
                <span className={s.stemLabel}>{meta.label}</span>
                {meta.sub && <span className={s.stemSub}>{meta.sub}</span>}
              </div>
              <div className={s.stemBtns}>
                <button type="button" className={s.toggle} data-on={c.solo}
                  onClick={() => patch(c.id, { solo: !c.solo })} aria-pressed={c.solo}>S</button>
                <button type="button" className={s.toggleMute} data-on={c.mute}
                  onClick={() => patch(c.id, { mute: !c.mute })} aria-pressed={c.mute}>M</button>
              </div>
            </div>
            <div className={s.wave} aria-hidden="true">
              {waveBars(c.id).map((bh, i) => (
                <div key={i} style={{ height: `${Math.round(bh * 100)}%` }} />
              ))}
            </div>
            <div className={s.volRow}>
              <span className={`${s.vlab} mono`}>VOL</span>
              <Slider.Root className={s.slider} min={0} max={1} step={0.01} value={[c.volume]}
                onValueChange={([v]) => patch(c.id, { volume: v ?? 0 })}>
                <Slider.Track className={s.track}><Slider.Range className={s.range} /></Slider.Track>
                <Slider.Thumb className={s.thumb} aria-label={`${meta.label} volume`} />
              </Slider.Root>
              <span className={`${s.volVal} mono`}>{Math.round(c.volume * 100)}</span>
            </div>
          </div>
        );
      })}

      <div className={s.deckFoot}>
        <span className={`${s.footCount} mono`}>{playingCount} of {stems.length} playing</span>
      </div>
    </div>
  );
}

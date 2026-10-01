/* Listen stage placement prefs. These are about the VIEWER, not the track, so
 * they live under one localStorage key rather than per version. Every access is
 * try/catch'd: the page must work in a private window, with site data blocked,
 * and in a test environment that has no storage at all. */
import { useCallback, useRef, useState } from 'react';

export type StageContent = 'findings' | 'visualizer';

export interface StagePrefs {
  content: StageContent;
  /** The visualizer is playing full-screen BEHIND the page. */
  bgViz: boolean;
}

export const STAGE_PREFS_KEY = 'listenStagePrefs';

/**
 * Spec D6, as amended 2026-10-01 (owner): the first visit opens with the
 * visualizations ON — playing full-screen in the background, behind the
 * findings board. This is only the DEFAULT: a stored choice always wins,
 * because someone who switched the background off meant it.
 *
 * The earlier prefers-reduced-motion carve-out (background off by default) is
 * gone at the owner's request; the visualizer itself still honours reduced
 * motion for its flash effects, and the ⛶/⤡ control turns it off in one click.
 */
export function defaultStagePrefs(): StagePrefs {
  return { content: 'findings', bgViz: true };
}

/** Only the fields the viewer actually CHOSE. A field that was never touched
 *  is absent, so it keeps following the default — even if the default changes
 *  later. */
type StoredStagePrefs = Partial<StagePrefs>;

function readStored(): StoredStagePrefs {
  try {
    const raw = localStorage.getItem(STAGE_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const obj = parsed as Record<string, unknown>;
    const out: StoredStagePrefs = {};
    if (obj['content'] === 'visualizer' || obj['content'] === 'findings') out.content = obj['content'];
    if (typeof obj['bgViz'] === 'boolean') out.bgViz = obj['bgViz'];
    return out;
  } catch {
    return {};
  }
}

export function readStagePrefs(): StagePrefs {
  return { ...defaultStagePrefs(), ...readStored() };
}

/** Persist the given fields (merged over what is already stored). Untouched
 *  fields are NOT written, so switching Findings -> Visualizer never freezes
 *  the current background default in as if it had been chosen. */
export function writeStagePrefs(prefs: StoredStagePrefs): void {
  try {
    localStorage.setItem(STAGE_PREFS_KEY, JSON.stringify({ ...readStored(), ...prefs }));
  } catch {
    /* quota / unavailable — the page works without it */
  }
}

export interface StagePrefsHandle extends StagePrefs {
  setContent: (content: StageContent) => void;
  setBgViz: (bgViz: boolean) => void;
}

export function useStagePrefs(): StagePrefsHandle {
  const [prefs, setPrefs] = useState<StagePrefs>(readStagePrefs);
  // The storage write happens HERE, in the event handler — never inside a
  // `setPrefs` updater: React re-runs updaters under StrictMode, which would
  // write twice. The ref keeps two same-tick updates composing.
  const latest = useRef(prefs);
  const update = useCallback((patch: Partial<StagePrefs>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    writeStagePrefs(patch);
    setPrefs(next);
  }, []);
  const setContent = useCallback((content: StageContent) => update({ content }), [update]);
  const setBgViz = useCallback((bgViz: boolean) => update({ bgViz }), [update]);
  return { ...prefs, setContent, setBgViz };
}

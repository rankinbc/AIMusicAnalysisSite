/* Listen stage placement prefs. These are about the VIEWER, not the track, so
 * they live under one localStorage key rather than per version. Every access is
 * try/catch'd: the page must work in a private window, with site data blocked,
 * and in a test environment that has no storage at all. */
import { useCallback, useState } from 'react';

export type StageContent = 'findings' | 'visualizer';

export interface StagePrefs {
  content: StageContent;
  /** The visualizer is playing full-screen BEHIND the page. */
  bgViz: boolean;
}

export const STAGE_PREFS_KEY = 'listenStagePrefs';

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/**
 * Spec D6 — first visit is findings in the box with the visuals behind the
 * page, except under prefers-reduced-motion, where nothing moves until the
 * viewer asks for it. This is only the DEFAULT: a stored choice always wins,
 * because someone who switched the background on meant it.
 */
export function defaultStagePrefs(): StagePrefs {
  return { content: 'findings', bgViz: !prefersReducedMotion() };
}

export function readStagePrefs(): StagePrefs {
  const fallback = defaultStagePrefs();
  try {
    const raw = localStorage.getItem(STAGE_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const obj = parsed as Record<string, unknown>;
    return {
      content: obj['content'] === 'visualizer' ? 'visualizer' : 'findings',
      bgViz: typeof obj['bgViz'] === 'boolean' ? obj['bgViz'] : fallback.bgViz,
    };
  } catch {
    return fallback;
  }
}

export function writeStagePrefs(prefs: StagePrefs): void {
  try {
    localStorage.setItem(STAGE_PREFS_KEY, JSON.stringify(prefs));
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
  const update = useCallback((patch: Partial<StagePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writeStagePrefs(next);
      return next;
    });
  }, []);
  const setContent = useCallback((content: StageContent) => update({ content }), [update]);
  const setBgViz = useCallback((bgViz: boolean) => update({ bgViz }), [update]);
  return { ...prefs, setContent, setBgViz };
}

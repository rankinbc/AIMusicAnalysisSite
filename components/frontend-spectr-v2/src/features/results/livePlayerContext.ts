// The analysis page's "listen while it analyzes" player — the context half.
// LivePlayerProvider (the results route owns it) holds the ONE <audio> element
// and its Web Audio analyser so playback survives the live page → report
// hand-off (two different trees mount the analysis page; the provider sits
// above both). The page's play button + background visuals read it here.
// No provider (anon/guest jobs without a version, tests) → null → no player.

import { createContext, useContext } from 'react';

export interface LivePlayer {
  /** Truthful mirror of the media element (play/pause/ended events). */
  playing: boolean;
  /** The audio failed to load after the retry gave up. */
  unavailable: boolean;
  /** Play/pause. Creates the AudioContext on the first call — call it from a
   *  click handler (autoplay policy). */
  toggle: () => void;
  pause: () => void;
  /** The media element, for components that track time themselves (so a
   *  timeupdate never re-renders the whole results route). */
  audio: HTMLAudioElement | null;
  /** The analyser on the playing mix; null until the first play, or when Web
   *  Audio isn't available (playback still works, visuals idle-animate). */
  getAnalyser: () => AnalyserNode | null;
  /** Mount bookkeeping: the page registers while it's on screen; when none is
   *  left (report opened, page dismissed) playback stops. */
  attach: () => () => void;
}

export const LivePlayerContext = createContext<LivePlayer | null>(null);

export function useLivePlayer(): LivePlayer | null {
  return useContext(LivePlayerContext);
}

export interface LoopState {
  enabled: boolean;
  inSec: number | null;
  outSec: number | null;
}

export const LOOP_DEFAULT: LoopState = { enabled: false, inSec: null, outSec: null };

// Pitch panel state (caller-owned; useAudioGraph is the source of audio truth).
export interface PitchPanelState {
  semitones: number;
  cents: number;
  enabled: boolean;
  decoding: boolean;
  decodeError: string | null;
}

export const PITCH_PANEL_DEFAULT: PitchPanelState = {
  semitones: 0,
  cents: 0,
  enabled: false,
  decoding: false,
  decodeError: null,
};

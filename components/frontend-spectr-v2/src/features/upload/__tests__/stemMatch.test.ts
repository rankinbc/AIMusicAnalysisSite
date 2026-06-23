import { describe, expect, it } from 'vitest';

import {
  guessRoleFromName,
  matchStemsToTracks,
  nameSimilarity,
  normalizeTokens,
} from '../stemMatch';

describe('normalizeTokens', () => {
  it('strips extension, separators, and noise words', () => {
    expect(normalizeTokens('01_Reese-Bass_STEM.wav')).toEqual(['01', 'reese', 'bass']);
    expect(normalizeTokens('Lead Vocal (export).flac')).toEqual(['lead', 'vocal']);
  });
});

describe('nameSimilarity', () => {
  it('scores identical normalized names as 1', () => {
    expect(nameSimilarity('Reese Bass.wav', 'Reese Bass')).toBe(1);
  });

  it('gives a containment bonus for partial overlap', () => {
    expect(nameSimilarity('bass.wav', 'Reese Bass Layer')).toBeGreaterThanOrEqual(0.6);
  });

  it('scores unrelated names low', () => {
    expect(nameSimilarity('kick.wav', 'Lead Vocal')).toBe(0);
  });
});

describe('matchStemsToTracks', () => {
  const tracks = ['Lead Vocal', 'Reese Bass', 'Pluck Arp', 'Kick'];

  it('matches filenames to their best track in input order', () => {
    const out = matchStemsToTracks(
      ['reese_bass_stem.wav', '01 Lead Vocal.flac', 'kick.wav'],
      tracks,
    );
    expect(out.map((m) => m.trackName)).toEqual(['Reese Bass', 'Lead Vocal', 'Kick']);
    expect(out[0].score).toBe(1);
  });

  it('returns null when nothing clears the threshold', () => {
    const out = matchStemsToTracks(['random_noise_blip.wav'], tracks);
    expect(out[0].trackName).toBeNull();
  });

  it('lets multiple stems map to the same track', () => {
    const out = matchStemsToTracks(['bass_DI.wav', 'bass_amp.wav'], ['Reese Bass']);
    expect(out.every((m) => m.trackName === 'Reese Bass')).toBe(true);
  });

  it('handles empty track list gracefully', () => {
    const out = matchStemsToTracks(['kick.wav'], []);
    expect(out[0]).toMatchObject({ trackName: null, score: 0 });
  });
});

describe('guessRoleFromName', () => {
  it.each([
    ['kick_01.wav', 'kick'],
    ['Snare top.wav', 'snare'],
    ['closed_hats.flac', 'hats'],
    ['Drum Bus.wav', 'drums'],
    ['Reese Bass.wav', 'bass'],
    ['808 sub.wav', 'bass'],
    ['Lead Vocal.wav', 'vocals'],
    ['main_lead_synth.wav', 'lead'],
    ['warm pad.wav', 'pad'],
    ['riser_fx.wav', 'fx'],
  ] as const)('maps %s → %s', (name, role) => {
    expect(guessRoleFromName(name)).toBe(role);
  });

  it('returns null when no keyword matches', () => {
    expect(guessRoleFromName('untitled_3.wav')).toBeNull();
  });
});

// Specialist catalog: slug → display label + UI grouping.
// Must stay in sync with components/bff/src/Spectr.Bff/Services/SpecialistCatalog.cs
// and components/worker/app/verdict_lib/prompt_loader.py.

export interface SpecialistMeta {
  slug: string;
  label: string;
  group: SpecialistGroup;
  /** Disabled when the upload has no stems (slice-1 path is always stem-less). */
  needsStems?: boolean;
}

export type SpecialistGroup =
  | 'Spectrum'
  | 'Loudness'
  | 'Dynamics'
  | 'Stereo'
  | 'Sections'
  | 'Stems'
  | 'Misc';

export const SPECIALIST_CATALOG: ReadonlyArray<SpecialistMeta> = [
  // Spectrum
  { slug: 'low_end', label: 'Low End', group: 'Spectrum' },
  { slug: 'frequency_balance', label: 'Frequency Balance', group: 'Spectrum' },
  { slug: 'frequency_collision', label: 'Frequency Collisions', group: 'Spectrum' },
  { slug: 'clarity', label: 'Clarity', group: 'Spectrum' },
  { slug: 'harmonic', label: 'Harmonic Content', group: 'Spectrum' },

  // Loudness
  { slug: 'loudness', label: 'Loudness', group: 'Loudness' },
  { slug: 'gain_staging', label: 'Gain Staging', group: 'Loudness' },
  { slug: 'playback', label: 'Playback Targets', group: 'Loudness' },

  // Dynamics
  { slug: 'dynamics', label: 'Dynamics', group: 'Dynamics' },
  { slug: 'humanization', label: 'Humanization', group: 'Dynamics' },
  { slug: 'density', label: 'Density / Busyness', group: 'Dynamics' },

  // Stereo
  { slug: 'stereo_phase', label: 'Stereo Phase', group: 'Stereo' },
  { slug: 'stereo_field', label: 'Stereo Field', group: 'Stereo' },
  { slug: 'spatial', label: 'Spatial', group: 'Stereo' },
  { slug: 'surround', label: 'Mono Compatibility', group: 'Stereo' },

  // Sections / Arrangement
  { slug: 'sections', label: 'Sections', group: 'Sections' },
  { slug: 'section_contrast', label: 'Section Contrast', group: 'Sections' },
  { slug: 'trance_arrangement', label: 'Trance Arrangement', group: 'Sections' },
  { slug: 'chord_harmony', label: 'Chord / Harmony', group: 'Sections' },
  { slug: 'device_chain', label: 'Device Chain', group: 'Sections' },

  // Stems-only
  { slug: 'stem_reference', label: 'Stem Reference', group: 'Stems', needsStems: true },
  { slug: 'stem_balance', label: 'Stem Balance', group: 'Stems', needsStems: true },
  { slug: 'stem_stereo_width', label: 'Stem Stereo Width', group: 'Stems', needsStems: true },
  { slug: 'stem_reference_delta', label: 'Stem Reference Δ', group: 'Stems', needsStems: true },

  // Misc / Summary
  { slug: 'overall', label: 'Overall Score', group: 'Misc' },
  { slug: 'priority_summary', label: 'Priority Summary', group: 'Misc' },
];

export const SPECIALIST_GROUPS: ReadonlyArray<SpecialistGroup> = [
  'Spectrum',
  'Loudness',
  'Dynamics',
  'Stereo',
  'Sections',
  'Stems',
  'Misc',
];

export function specialistLabel(slug: string): string {
  return SPECIALIST_CATALOG.find((s) => s.slug === slug)?.label ?? slug;
}

export function specialistGroup(slug: string): SpecialistGroup | null {
  return SPECIALIST_CATALOG.find((s) => s.slug === slug)?.group ?? null;
}

/** Persona color for a specialist group. Used for MiniBot avatars, filter
 *  pills, and verdict-card accents so each category reads as one "voice." */
export function groupColor(group: SpecialistGroup): string {
  switch (group) {
    case 'Spectrum':
      return 'var(--cyan)';
    case 'Loudness':
      return 'var(--orange)';
    case 'Dynamics':
      return 'var(--yellow)';
    case 'Stereo':
      return 'var(--blue)';
    case 'Sections':
      return 'var(--violet)';
    case 'Stems':
      return 'var(--green)';
    case 'Misc':
    default:
      return 'var(--muted)';
  }
}

export function specialistColor(slug: string): string {
  const g = specialistGroup(slug);
  return g ? groupColor(g) : 'var(--muted)';
}

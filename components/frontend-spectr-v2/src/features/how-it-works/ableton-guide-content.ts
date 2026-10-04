// Copy for the "Optimal Ableton export instructions" modal (AbletonExportGuide.tsx).
export interface GuideSection {
  title: string;
  steps: string[];
  why?: string;
}

// Menu and option names are Ableton Live's own (Export Audio/Video dialog).
export const ABLETON_GUIDE: readonly GuideSection[] = [
  {
    title: '1 · The mix',
    steps: [
      'In the Arrangement, select the whole song — from the first sound to the end of the last tail.',
      'Open File → Export Audio/Video (Ctrl/Cmd + Shift + R).',
      'Rendered Track: Main (called Master before Live 12).',
      'File Type: WAV or FLAC. Bit Depth: 24. Sample Rate: your project’s rate.',
      'Normalize: Off. Render as Loop: Off. Convert to Mono: Off.',
    ],
    why: 'Normalize changes the loudness SPECTR measures. Leave it off so the report reflects your real level.',
  },
  {
    title: '2 · The stems',
    steps: [
      'Keep the same selection and open the same dialog.',
      'Rendered Track: All Individual Tracks — or Selected Tracks Only, with the tracks you want selected.',
      'Use the same File Type, Bit Depth and Sample Rate as the mix, with Normalize off.',
      'Turn Include Return and Master Effects off, so each stem is that track on its own.',
      'Live writes one file per track, all the same length, so they line up. Leave out the Main file — that is your mix.',
      'If you use groups, upload either the group stems or the tracks inside them, not both, or the same audio is counted twice.',
    ],
    why: 'Name your tracks before exporting: the files take the track names, and SPECTR uses them alongside what it hears to sort the stems into roles. WAV or FLAC, up to 100 stems.',
  },
  {
    title: '3 · The project',
    steps: [
      'Save the Live Set (Ctrl/Cmd + S).',
      'Upload the .als file itself — Live 11 or later.',
    ],
    why: 'With the project, fixes are addressed to your own tracks and devices instead of to the master.',
  },
];

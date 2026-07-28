// Plain-language definitions for mix jargon (prototype AR_GLOSSARY). Rendered
// by <Glossify> as dotted-underline tooltip spans. Kept out of glossary.tsx so
// the component file stays react-refresh clean.

export const GLOSSARY: readonly (readonly [string, string])[] = [
  ['true-peak', 'The real peak of the analog waveform between digital samples. It can poke above 0 even when samples don’t — lossy codecs (Spotify, YouTube) then distort. Keep it under −1 dBTP.'],
  ['dBTP', 'Decibels True-Peak — the unit for true-peak level. 0 dBTP is the absolute ceiling; masters usually target −1 dBTP.'],
  ['LUFS', 'Loudness Units Full Scale — how loud the track feels to human ears, averaged over time. Streaming services use it to turn tracks down to a common level.'],
  ['dBFS', 'Decibels relative to digital full scale — 0 dBFS is the loudest a digital file can store; everything sits below it as negative numbers.'],
  ['RMS', 'The average energy of the signal — a “how loud overall” measure, as opposed to momentary peaks.'],
  ['correlation', 'How similar the left and right channels are. +1 = identical (mono-safe), 0 = unrelated, negative = phase-cancelling — parts can vanish on mono systems.'],
  ['crest factor', 'The gap between peaks and average level. Big gap = punchy and dynamic; small gap = dense and compressed.'],
  ['headroom', 'Spare space between your loudest peak and the digital ceiling — room left for mastering moves without clipping.'],
  ['sidechain', 'Ducking one sound whenever another plays — classically, the bass dips for a moment each time the kick hits, so both stay clear.'],
  ['inter-sample peaks', 'Peaks that occur between two digital samples — the cause of true-peak overs.'],
  ['spectral centroid', 'The “center of mass” of the spectrum — a brightness measure. Higher = brighter, lower = darker.'],
  ['mono compatibility', 'How much of the mix survives when left and right are summed to one channel — club and phone speakers are effectively mono.'],
];

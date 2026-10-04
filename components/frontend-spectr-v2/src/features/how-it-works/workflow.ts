// The /trust/how-its-built page is a walkthrough of ONE session with SPECTR,
// in the order a producer goes through it: what you do at each step, and what
// SPECTR does in return. What each part can do in depth belongs on /features —
// this page is the sequence. Every line traces to a shipped surface; the
// comment above each entry names it. If a cited behaviour changes, change the
// copy here in the same commit.

export interface WorkflowStep {
  /** Carousel tab + panel id. */
  id: 'upload' | 'pipeline' | 'findings' | 'coach' | 'listen' | 'daw' | 'next';
  /** Short tab label. */
  label: string;
  you: string;
  spectr: string;
  /** How long this step takes, or what it needs. */
  note: string;
  /** The Coach, not the engine, is who you deal with at this step. */
  coach?: true;
}

export const WORKFLOW: readonly WorkflowStep[] = [
  // anon-analyze/AnalyzePage (no account, WAV/FLAC/MP3 ≤250 MB);
  // components/UnifiedUploadDialog (optional stems / .als / reference, genre
  // hint); analysis converters.to_wav; the classify_stems worker actor.
  {
    id: 'upload',
    label: 'Upload',
    you: 'Drop in a bounce of your mix — WAV, FLAC or MP3, up to 250 MB. Your first one needs no account. If you have them, add your stems, your Ableton project or a reference track, and tell SPECTR the genre.',
    spectr: 'Converts everything to one format so every track is measured the same way, and sorts any stems into roles by listening to them.',
    note: 'About a minute',
  },
  // results/LiveAnalysisView + AnalysisCompleteModal (step list with live
  // values, coach narration, specialists list, live findings, LiveTransport
  // "Listen while it analyzes"); helpers/coachWaitLines ("each one takes
  // about a minute").
  {
    id: 'pipeline',
    label: 'Analysis',
    you: 'Nothing — or press play and listen to your track while it works. Each measurement ticks off as it finishes, and the first findings appear before the analysis is done.',
    spectr: 'Measures the mix, checks it against fixed rules, then picks the AI specialists your track needs and runs them. The Coach narrates what it is finding as it goes.',
    note: 'A few minutes — about a minute per specialist',
  },
  // results/FixBoard (mode=findings) + FindingDetail (why it matters, the
  // data, "Ignore this finding"); verdict validator + scoring.py priority.
  {
    id: 'findings',
    label: 'Findings',
    you: 'Open the full report and read the findings, most important first. Open any one to see the measurements behind it and why it matters, and ignore the ones you disagree with.',
    spectr: 'Ranks every finding with a fixed formula, and checks each number a finding cites against your analysis before you see it.',
    note: 'At your own pace',
  },
  // results/CoachChat (modes, evidence chips, "Ask the Coach about this");
  // coach_lib/context.py (report-grounded, no audio).
  {
    id: 'coach',
    label: 'Ask the Coach',
    you: 'Ask about anything you do not follow — why a finding matters, which fix to make first, what a move will do to the sound. Choose Concise, Normal or Teach for how much explanation you want.',
    spectr: 'Answers from your report’s measurements and findings, and links the numbers it relied on. It reads the analysis, not the audio.',
    note: 'Whenever you are stuck',
    coach: true,
  },
  // results/ActionDetail ("Add to fix rack"), ActionsBar (Try Fixes, Coach
  // Mix), listen-rack/ListenRackPage (Apply live, BYPASS, presets; ≥1024 px).
  {
    id: 'listen',
    label: 'Hear it',
    you: 'Tick the fixes you want to try, open the Listen page, and switch each one on while your track plays. Flip Bypass to compare with the original, adjust any setting, and keep only what you like — or let Coach Mix merge your picks into one chain.',
    spectr: 'Plays your own track through a rack in the browser and applies each fix live — no export, no plugin.',
    note: 'Needs a desktop-width screen',
  },
  // results/ImprovementPlanTab + ExportModal + export-generator (Markdown /
  // plain text, signal-chain order); ActionDetail "Mark applied".
  {
    id: 'daw',
    label: 'To your DAW',
    you: 'Export the DAW Plan, open your project and make the moves you chose, ticking each one off as you go. Back in SPECTR, mark those fixes as applied.',
    spectr: 'Lays your chosen fixes out in signal-chain order with the exact settings for each device, as Markdown or plain text.',
    note: 'One file to keep open beside your DAW',
  },
  // song/SongConsole ("+ Add version", QuickPlayer A/B decks, ComparePanel
  // "What changed", notes); library/SongsLibrarySection.
  {
    id: 'next',
    label: 'Next version',
    you: 'Bounce the new mix and add it to the same song as a new version. Load the old and the new onto the two decks and switch between them to hear whether it is actually better.',
    spectr: 'Analyses the new version, shows what changed between any two — loudness, dynamics, bass, highs, stereo width — and keeps every version, report and note in your library.',
    note: 'Then round again, until it is done',
  },
];

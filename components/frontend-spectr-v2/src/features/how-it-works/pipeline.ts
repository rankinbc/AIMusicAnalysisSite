// The /trust/how-its-built page's analysis content: the upload -> plan pipeline
// (the page's step order and you/SPECTR copy live in workflow.ts). Every sentence is producer-facing but traces to code; the
// comment above each entry names the file(s) that back it. If a cited
// behaviour changes, change the copy here in the same commit.

export type StepKind = 'input' | 'measure' | 'rules' | 'ai' | 'check' | 'plan' | 'hear';

export interface PipelineStep {
  id: string;
  title: string;
  kind: StepKind;
  body: string;
}

export interface PipelineStage {
  id: string;
  label: string;
  steps: readonly PipelineStep[];
}

// Chip text per kind — tells the reader at a glance which steps are plain
// measurement, which are fixed rules and which use AI.
export const KIND_LABEL: Record<StepKind, string> = {
  input: 'Your files',
  measure: 'Measurement',
  rules: 'Fixed rules',
  ai: 'AI',
  check: 'Validation',
  plan: 'Your plan',
  hear: 'In your browser',
};

export const STAGES: readonly PipelineStage[] = [
  {
    id: 'measure',
    label: 'Measure',
    steps: [
      // analysis/src/audio_analysis/pipeline.py (run_pipeline -> to_wav first;
      // als_file_path / stem_paths / reference_path inputs); converters.py
      // (44100 Hz target). BFF upload accepts WAV/FLAC/MP3.
      {
        id: 'upload',
        title: 'Upload your track',
        kind: 'input',
        body:
          'Drop in a WAV, FLAC or MP3. You can also add stems, a reference track or your Ableton Live ' +
          'project (.als) for a deeper read. Every file is converted to 44.1 kHz WAV first, so every ' +
          'track is measured the same way.',
      },
      // phases/phase1_universal.py output keys: lufs, loudness_range_lu,
      // true_peak_db, clipping_detected, crest_factor, bands (7),
      // stereo_width, stereo_correlation, mono_compatibility, bpm,
      // detected_key, transients.transients_per_second.
      {
        id: 'measure',
        title: 'Measure the mix',
        kind: 'measure',
        body:
          'The analysis pipeline measures integrated loudness and loudness range, true peak and clipping, ' +
          'crest factor, tonal balance across seven bands, stereo width and correlation, mono ' +
          'compatibility, tempo, key and transient density.',
      },
      // phase2_genre.py (BPM + spectral rules), phase3_genre_specific.py
      // (per-genre rubrics), phase6_gap.py (statistical profile from
      // professional reference tracks), phase4_stems.py (spectral band clash
      // detection), phase9_translation.py (headphone/speaker/mono).
      {
        id: 'context',
        title: 'Put it in context',
        kind: 'measure',
        body:
          'SPECTR estimates the genre from tempo and spectral balance, scores the track with that ' +
          "genre's rubric and compares it with a profile built from professional reference tracks. It " +
          'also looks for frequency ranges where elements compete, and checks how the mix holds up on ' +
          'headphones, speakers and in mono.',
      },
      // stems/analyzer.py (per-stem bands, loudness, stereo width, clash
      // matrix); phase5_reference.py (feature deltas vs the reference);
      // phase8_als.py + als/als_parser.py, midi_analyzer.py, health_scorer.py
      // (tracks, devices, MIDI).
      {
        id: 'deeper',
        title: 'Go deeper with what you add',
        kind: 'measure',
        body:
          "With stems, each stem's loudness, balance and stereo width are measured and clashes between " +
          'stems are mapped. With a reference track, your mix is compared with it measurement by ' +
          'measurement. With an Ableton project, SPECTR reads your tracks, devices and MIDI.',
      },
    ],
  },
  {
    id: 'diagnose',
    label: 'Diagnose',
    steps: [
      // worker/app/verdict_lib/rule_engine.py (evaluate_problems: singles ->
      // composites -> suppression; genre-relative thresholds via
      // genre_config / config/genre-profiles.json; rules return None on
      // absent inputs). Runs on every completed analysis
      // (tasks_dramatiq.analyze_audio_job Phase C2).
      {
        id: 'rules',
        title: 'Flag problems with fixed rules',
        kind: 'rules',
        body:
          'A deterministic rule engine checks the measurements against genre-relative thresholds, so ' +
          'the same reading can earn a different severity in a different genre. Related problems are ' +
          'merged into one finding, and no rule grades data that isn’t there.',
      },
      // worker/app/triage_actor.py + prompts/experts/Triage.md
      // (SpecialistRoutingPlan: specialists_to_run with a focus each, skip).
      {
        id: 'triage',
        title: 'Triage the track',
        kind: 'ai',
        body:
          'An AI triage step reads the measurements and decides which specialists this track needs — ' +
          'with a focus for each — and which to skip.',
      },
      // verdict_lib/prompt_loader.py SLUG_TO_FILENAME (26 specialists);
      // aimusic_shared/verdicts/models.py (Verdict.evidence, Fix.dsp_chain,
      // DspOp params: frequency_hz/gain_db/q, threshold_db/ratio/attack_ms/
      // release_ms); results/useSpecialistRuns.ts auto-runs the Triage-suggested
      // specialists, the rest run on demand (useRunSpecialist).
      {
        id: 'specialists',
        title: 'Specialists diagnose',
        kind: 'ai',
        body:
          'More than 20 specialist roles cover low end, loudness, dynamics, frequency balance, stereo ' +
          'and phase, clarity, translation, stems and more. Each finding cites the measurements behind ' +
          'it, and its fix is a processing chain with exact settings: EQ frequency, gain and Q; ' +
          'compressor threshold, ratio, attack and release. The suggested specialists run when you open ' +
          'the report; the rest are one click away.',
      },
      // worker/app/verdict_lib/validator.py (metric path must resolve +
      // value within 10%; .als track grounding; moderate-baseline severity
      // downgrade; priority recomputed) + aimusic_shared/verdicts/models.py
      // (_DSP_PARAM_RANGES) + aimusic_shared/verdicts/scoring.py.
      {
        id: 'validate',
        title: 'Check every finding',
        kind: 'check',
        body:
          'Before a finding reaches you, every measurement it cites must exist in your analysis and ' +
          'match the measured value within 10%. Fix settings must sit inside valid ranges, and a fix ' +
          'aimed at an Ableton track must name a track that’s really in your project. A fixed formula ' +
          'then sets the priority — the AI can’t rank its own findings or inflate their severity.',
      },
    ],
  },
  {
    id: 'act',
    label: 'Act',
    steps: [
      // results/results-tabs-model.ts (Findings / Actions / Improvement
      // Plan); ImprovementPlanTab.tsx (by-move priority order, per-device
      // Master first, timestamped moments, genre targets, export);
      // export-generator.ts (md | txt); worker/app/fix_rack_actor.py +
      // coach_mix/arbiter.py (COMBINE + GUARD) + solve_lib/weighted_merge.py
      // (EQ_MAX_TOTAL_BOOST_DB, MAX_CUT_DEPTH_DB, COMP_RATIO_CAP,
      // MAX_CUMULATIVE_GAIN_DB).
      {
        id: 'plan',
        title: 'Build the plan',
        kind: 'plan',
        body:
          'Findings become Actions and an Improvement Plan: moves in priority order, a per-device view ' +
          'with the master first, timestamped moments and genre targets — exportable as Markdown or ' +
          'text for your session. SPECTR can also compile the fixes into one Coach Mix rack preset, ' +
          'merging overlapping moves and capping total EQ boost, cut depth, compression ratio and gain.',
      },
      // features/listen-rack/data.ts (EQ 8-band, Compressor, Saturator, M/S
      // Width + mono-maker, Limiter true-peak, Output Trim, ...);
      // rackCore.tsx ("A / B Bypass"); useFixOverlay / listenFixes.ts (fixes
      // carried into the rack); features/listen/useAudioGraph.ts (Web Audio).
      {
        id: 'listen',
        title: 'Hear it on your track',
        kind: 'hear',
        body:
          'Send fixes to the Listen rack and hear them on your own track, live in the browser: an ' +
          '8-band EQ, compressor, saturator, M/S width with a mono-maker, a true-peak limiter and more. ' +
          'Flip the A/B bypass to compare with the original, adjust any setting, then make the move in ' +
          'your DAW knowing how it sounds.',
      },
      // worker/app/coach_lib/context.py (the coach answers only from the
      // report bundle; unresolvable citations are dropped);
      // results/CoachChatHeader.tsx (Concise | Normal | Teach).
      {
        id: 'coach',
        title: 'Ask the coach',
        kind: 'ai',
        body:
          'The coach answers from your report — your measurements and findings — and links the ' +
          'measured values it relies on. Switch between Concise, Normal and Teach modes for the short ' +
          'answer or the why behind it.',
      },
    ],
  },
];

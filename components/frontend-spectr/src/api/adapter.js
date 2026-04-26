function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Genre-typical frequency targets (in dB, same scale as phase1 bands)
const GENRE_FREQ_DB = {
  trance: { sub_bass: -22, bass: -18, low_mid: -20, mid: -22, upper_mid: -20, presence: -22, air: -18 },
  house:  { sub_bass: -16, bass: -15, low_mid: -19, mid: -23, upper_mid: -25, presence: -27, air: -32 },
  techno: { sub_bass: -20, bass: -17, low_mid: -17, mid: -17, upper_mid: -19, presence: -21, air: -30 },
  dnb:    { sub_bass: -14, bass: -16, low_mid: -21, mid: -24, upper_mid: -23, presence: -25, air: -29 },
  other:  { sub_bass: -19, bass: -18, low_mid: -20, mid: -21, upper_mid: -23, presence: -25, air: -29 },
};

const GENRE_LUFS = {
  trance: -8.5, house: -9.0, techno: -8.0, dnb: -9.5, other: -12.0,
};

const BAND_KEYS = ['sub_bass', 'bass', 'low_mid', 'mid', 'upper_mid', 'presence', 'air'];

function detectChartType(fix) {
  const f = fix.toLowerCase();
  if (/clash|overlap|stem/.test(f)) return 'stems';
  if (/lufs|loudness|stream|level|master/.test(f)) return 'lufs';
  return 'frequency';
}

function getMetricLine(fix, rawBands, lufs, clashes) {
  const f = fix.toLowerCase();
  if (/air/.test(f) && rawBands.air != null)
    return `Air: ${rawBands.air.toFixed(1)} dB (target ≥ −20 dB)`;
  if (/sub.?bass/.test(f) && rawBands.sub_bass != null)
    return `Sub bass: ${rawBands.sub_bass.toFixed(1)} dB`;
  if (/bass/.test(f) && rawBands.bass != null)
    return `Bass: ${rawBands.bass.toFixed(1)} dB`;
  if (/lufs|loudness|level/.test(f))
    return `LUFS: ${lufs.toFixed(1)} dB (Spotify target −14)`;
  if (/clash|stem/.test(f) && clashes.length > 0)
    return `${clashes[0].sev.toUpperCase()} clash · ${clashes[0].a} at ${clashes[0].range}`;
  return `Integrated: ${lufs.toFixed(1)} LUFS`;
}

export function adaptResult(apiResponse, filename) {
  const result = apiResponse.result ?? apiResponse;
  const phases  = result.phases ?? [];

  const getPhase = (n) => phases.find(p => p.phase === n)?.data ?? {};
  const p1 = getPhase(1);
  const p2 = getPhase(2);
  const p3 = getPhase(3);
  const p4 = getPhase(4);
  const p5 = getPhase(5);
  const p6 = getPhase(6);
  const p7 = getPhase(7);

  // ── Stem analysis (only present when user uploaded stems) ────────────────
  const stemBlock = (p4 && p4.stems && p4.stems.status === 'ok') ? p4.stems : null;
  const stems = stemBlock ? {
    perStem: stemBlock.per_stem ?? {},
    clashMatrix: stemBlock.clash_matrix ?? [],
    balanceFlags: stemBlock.balance_flags ?? [],
  } : null;
  const stemReferenceDeltas = (p5 && p5.stem_reference_comparison === 'ok')
    ? (p5.per_stem_reference_deltas ?? [])
    : null;

  // ── Core metadata ─────────────────────────────────────────────────────────
  const lufs  = typeof p1.lufs === 'number' ? p1.lufs : -14.0;
  const bpm   = Math.round(p1.bpm ?? p2.bpm ?? 120);
  const key   = p1.detected_key ?? '?';
  const dur   = typeof p1.duration_seconds === 'number' ? formatDuration(p1.duration_seconds) : '';
  const genre = p2.genre ?? 'other';
  const genreName  = capitalize(genre);
  const confidence = Math.round((p2.confidence ?? 0.5) * 100);
  const percentile = typeof p6.percentile === 'number' ? p6.percentile : null;
  const danceScore = typeof result.danceability_score === 'number' ? result.danceability_score : null;

  // ── Frequency bands ───────────────────────────────────────────────────────
  const rawBands = p1.bands ?? {};
  const bandValues = BAND_KEYS.map(k => rawBands[k] ?? -30).filter(v => typeof v === 'number');
  const trackMin = Math.min(...bandValues);
  const trackMax = Math.max(...bandValues);
  const trackRange = trackMax - trackMin || 1;
  const normTrack = (v) => (v - trackMin) / trackRange;

  const genreDbBands = GENRE_FREQ_DB[genre] ?? GENRE_FREQ_DB.other;
  const genreMedianBands = BAND_KEYS.map(k => Math.max(0, Math.min(1, normTrack(genreDbBands[k] ?? -20))));

  const BAND_META = [
    { n: 'Sub',    hz: '20–60',   key: 'sub_bass'  },
    { n: 'Bass',   hz: '60–250',  key: 'bass'       },
    { n: 'Lo-Mid', hz: '250–500', key: 'low_mid'    },
    { n: 'Mid',    hz: '500–2k',  key: 'mid'        },
    { n: 'Hi-Mid', hz: '2–6k',    key: 'upper_mid'  },
    { n: 'High',   hz: '6–10k',   key: 'presence'   },
    { n: 'Air',    hz: '10–20k',  key: 'air'        },
  ];
  const freqBands = BAND_META.map(({ n, hz, key: k }) => {
    const v = normTrack(rawBands[k] ?? -30);
    return { n, hz, v, warn: v > 0.88 };
  });
  const peakBand = freqBands.reduce((a, b) => a.v > b.v ? a : b, freqBands[0]);
  const clarityScore = Math.round(((freqBands[5]?.v ?? 0.5) * 60 + (freqBands[6]?.v ?? 0.5) * 40));

  // ── Loudness ──────────────────────────────────────────────────────────────
  const rmsLinear  = typeof p1.rms === 'number' ? p1.rms : null;
  const rmsDb      = rmsLinear != null ? parseFloat((20 * Math.log10(rmsLinear + 1e-9)).toFixed(1)) : -14.0;
  const truePeak   = typeof p1.true_peak_db === 'number' ? parseFloat(p1.true_peak_db.toFixed(1)) : -1.0;
  const dynRange   = typeof p1.true_peak_db === 'number' ? parseFloat((p1.true_peak_db - lufs).toFixed(1)) : 6.0;
  const clipping   = (p1.clipping_detected === true) || truePeak >= -0.5;

  // ── Stereo ────────────────────────────────────────────────────────────────
  const correlation  = typeof p1.stereo_correlation === 'number' ? p1.stereo_correlation : 0.5;
  const stereoWidthRaw = typeof p1.stereo_width === 'number' ? p1.stereo_width : 0.3;
  const stereoWidthPct = Math.min(100, Math.round(stereoWidthRaw * 100));
  const monoCompat   = typeof p1.mono_compatibility === 'number' ? p1.mono_compatibility : (correlation > 0.3 ? 0.75 : 0.4);

  // ── Streaming ─────────────────────────────────────────────────────────────
  const streamingRows = [
    { p: 'Spotify',     target: -14, yours: parseFloat(lufs.toFixed(1)) },
    { p: 'Apple Music', target: -16, yours: parseFloat(lufs.toFixed(1)) },
    { p: 'YouTube',     target: -14, yours: parseFloat(lufs.toFixed(1)) },
    { p: 'Tidal',       target: -14, yours: parseFloat(lufs.toFixed(1)) },
  ];
  const streamingPassCount = streamingRows.filter(r => r.yours <= r.target + 1).length;

  // ── Adapted stem clashes ──────────────────────────────────────────────────
  const clashes = (p4.clashes ?? []).map(c => {
    const parts = (c.stems ?? 'Stem A vs Stem B').split(/\s+vs\s+/i);
    return {
      a:   parts[0]?.trim() ?? 'Stem A',
      b:   parts[1]?.trim() ?? 'Stem B',
      range: c.frequency_range ?? '?',
      pct:  c.severity === 'high' ? 80 : 55,
      sev:  c.severity === 'high' ? 'severe' : 'moderate',
      fix:  c.eq_suggestion ?? `Reduce masking in ${c.frequency_range ?? 'this range'}`,
    };
  });

  // ── Fix queue ─────────────────────────────────────────────────────────────
  const topFixes       = result.top_fixes ?? [];
  const coachedFixesRaw = result.coached_fixes ?? [];
  const IMPACT_BADGES  = ['+8 pts', '+5 pts', '+3 pts'];

  const fixes = topFixes.slice(0, 3).map((fix, i) => ({
    rank:       i + 1,
    sev:        i === 0 ? 'critical' : 'warning',
    title:      fix.length > 68 ? fix.slice(0, 65) + '…' : fix,
    body:       fix,
    badge:      IMPACT_BADGES[i] ?? '',
    diff:       'Medium',
    coachFix:   coachedFixesRaw[i] ?? null,
    metricLine: getMetricLine(fix, rawBands, lufs, clashes),
    chartType:  detectChartType(fix),
  }));

  if (!fixes.length) {
    fixes.push({
      rank: 1, sev: 'ok',
      title: 'No critical issues found', body: 'Your mix is in good shape.',
      badge: '', diff: '', coachFix: null, metricLine: '', chartType: 'none',
    });
  }

  // ── Genre DNA (Phase 3 sub_scores) ────────────────────────────────────────
  const subScores = p3.sub_scores ?? {};
  const dnaParts = Object.entries(subScores).map(([k, v]) => ({
    n: k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    s: Math.round(Math.min(100, Math.max(0, v))),
    c: v >= 80 ? '#00e5b0' : v >= 60 ? '#a78bfa' : v >= 40 ? '#fbbf24' : '#fb923c',
  }));
  if (!dnaParts.length) {
    const s = Math.round(p3.total_score ?? 50);
    dnaParts.push({ n: genreName + ' Score', s, c: s >= 80 ? '#00e5b0' : s >= 60 ? '#a78bfa' : '#fb923c' });
  }

  // ── Gap analysis (Phase 6) ────────────────────────────────────────────────
  const gaps6 = p6.gaps ?? {};
  const gapEntries = Object.entries(gaps6);

  const FEAT_LABEL = {
    bpm: 'BPM', lufs: 'LUFS', rms: 'RMS',
    stereo_correlation: 'Stereo Correlation', stereo_width: 'Stereo Width',
    band_sub_bass: 'Sub Bass', band_bass: 'Bass', band_low_mid: 'Low Mid',
    band_mid: 'Mid', band_upper_mid: 'Hi-Mid', band_presence: 'Presence', band_air: 'Air',
  };
  const FEAT_UNIT = {
    bpm: ' BPM', lufs: ' LUFS', rms: ' dB',
    stereo_correlation: '', stereo_width: '',
    band_sub_bass: ' dB', band_bass: ' dB', band_low_mid: ' dB',
    band_mid: ' dB', band_upper_mid: ' dB', band_presence: ' dB', band_air: ' dB',
  };

  let gap;
  if (gapEntries.length > 0) {
    gap = gapEntries.map(([feat, d]) => {
      const userVal   = d.user_val  ?? null;
      const mean      = d.genre_mean ?? 0;
      const std       = d.genre_std  ?? 1;
      const delta     = d.delta      ?? (userVal != null ? userVal - mean : 0);
      const aRange    = d.acceptable_range ?? [mean - std, mean + std];
      const inRange   = d.in_range  ?? (userVal != null && userVal >= aRange[0] && userVal <= aRange[1]);
      const featPct   = typeof d.percentile === 'number' ? Math.round(d.percentile) : null;
      const legacyPct = feat === 'lufs'
        ? Math.max(0, Math.min(100, 100 - Math.max(0, delta) * 8))
        : Math.max(0, Math.min(100, 80 - Math.abs(delta) * 10));
      return {
        feat,
        n:           FEAT_LABEL[feat] ?? feat.replace(/^band_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        unit:        FEAT_UNIT[feat] ?? '',
        pct:         featPct ?? Math.round(legacyPct),
        sev:         inRange ? 'ok' : Math.abs(delta) > 2 * std ? 'critical' : 'warning',
        userVal, mean, std, delta, acceptableRange: aRange, inRange,
        description: d.description ?? null,
      };
    });
  } else {
    gap = [{ feat: 'overall', n: genreName + ' Percentile', unit: '', pct: Math.round(p6.percentile ?? 50), sev: 'ok', userVal: null, mean: null, std: null, delta: null, acceptableRange: null, inRange: true, description: null }];
  }

  // ── Arrangement (Phase 7) ─────────────────────────────────────────────────
  const violations = p7.violations ?? [];
  const arrangement = {
    score:    Math.max(0, 100 - violations.length * 15),
    sections: [],
    issues:   violations,
  };

  // ── Track name ────────────────────────────────────────────────────────────
  const trackName = (filename ?? 'Untitled Track').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
  const subParts = [];
  if (dur) subParts.push(dur);
  if (key !== '?') subParts.push(key);
  subParts.push(`${bpm} BPM`);

  return {
    // identity
    track:   { name: trackName, sub: subParts.join('  ·  ') },
    grade:   result.grade ?? 'C',
    score:   Math.round(result.overall_score ?? 50),
    bpm,
    key,
    // genre
    genre:      { name: genreName, confidence },
    percentile,
    danceScore,
    // fixes
    fixes,
    coachName:  result.coach_name ?? 'Coach',
    coachIntro: result.coach_intro ?? '',
    coachedFixes: coachedFixesRaw,
    // loudness
    loudness: { integrated: parseFloat(lufs.toFixed(1)), truePeak, dynamicRange: dynRange, rms: rmsDb },
    clipping,
    genreMedianLufs: GENRE_LUFS[genre] ?? -12,
    // streaming
    streaming:          streamingRows,
    streamingPassCount,
    // frequency
    frequency: { clarity: clarityScore, label: peakBand.n, bands: freqBands, genreMedianBands },
    // stereo
    stereo: { width: stereoWidthPct, correlation: parseFloat(correlation.toFixed(2)), monoSafe: correlation > 0.3, monoCompat },
    // phase data
    tranceDNA:   { overall: Math.round(p3.total_score ?? 50), parts: dnaParts },
    clashes,
    arrangement,
    gap,
    profileSource: p6.profile_source ?? null,
    // stems (null when user didn't upload stems)
    stems,
    stemReferenceDeltas,
  };
}

import { useCallback, useEffect, useState } from 'react';
import { EQLoader } from './primitives.jsx';
import VerdictCard from './VerdictCard.jsx';
import {
  dismissVerdict, getVerdicts, giveFeedback, runSpecialist,
} from '../api/verdicts.js';

// ── Catalog ───────────────────────────────────────────────────────────────────

const SUMMARY_SLUG = 'priority_summary';

const SPECIALIST_CATEGORIES = [
  { id: 'low-end',     label: 'Low End',           slugs: ['low_end', 'stem_balance'] },
  { id: 'frequency',   label: 'Frequency',         slugs: ['frequency_balance', 'frequency_collision', 'harmonic', 'chord_harmony'] },
  { id: 'dynamics',    label: 'Dynamics',          slugs: ['dynamics', 'humanization', 'density'] },
  { id: 'stereo',      label: 'Stereo & Width',    slugs: ['stereo_phase', 'stereo_field', 'spatial', 'stem_stereo_width'] },
  { id: 'loudness',    label: 'Loudness',          slugs: ['loudness', 'gain_staging', 'playback'] },
  { id: 'arrangement', label: 'Arrangement',       slugs: ['sections', 'trance_arrangement', 'section_contrast'] },
  { id: 'reference',   label: 'Reference',         slugs: ['stem_reference', 'stem_reference_delta'] },
  { id: 'detail',      label: 'Production Detail', slugs: ['clarity', 'surround', 'device_chain'] },
  { id: 'overall',     label: 'Big Picture',       slugs: ['overall'] },
];

const SPECIALIST_LABELS = {
  low_end:              'Low End',
  frequency_balance:    'Frequency Balance',
  frequency_collision:  'Frequency Collisions',
  harmonic:             'Harmonic Analysis',
  chord_harmony:        'Chord Harmony',
  dynamics:             'Dynamics',
  humanization:         'Humanization',
  density:              'Density / Busyness',
  stereo_phase:         'Stereo & Phase',
  stereo_field:         'Stereo Field',
  spatial:              'Spatial',
  stem_stereo_width:    'Stem Stereo Width',
  loudness:             'Loudness',
  gain_staging:         'Gain Staging',
  playback:             'Playback Optimization',
  sections:             'Sections',
  trance_arrangement:   'Trance Arrangement',
  section_contrast:     'Section Contrast',
  stem_reference:       'Stem vs Reference',
  stem_reference_delta: 'Stem Reference Delta',
  clarity:              'Clarity',
  surround:             'Surround Compat',
  device_chain:         'Device Chain',
  overall:              'Overall Score',
  stem_balance:         'Stem Balance',
  priority_summary:     'Priority Summary',
};

const SPECIALIST_REQUIREMENTS = {
  stem_balance:         ['stems'],
  stem_stereo_width:    ['stems'],
  stem_reference_delta: ['stems', 'reference'],
  device_chain:         ['als'],
};

const REQUIREMENT_LABELS = {
  stems:     'stems',
  als:       'an .als project file',
  reference: 'a reference track',
};

function missingReason(slug, inputs) {
  const reqs = SPECIALIST_REQUIREMENTS[slug] ?? [];
  const missing = reqs.filter(r =>
    (r === 'stems'     && !inputs?.hasStems)     ||
    (r === 'als'       && !inputs?.hasAls)       ||
    (r === 'reference' && !inputs?.hasReference)
  );
  if (!missing.length) return null;
  const list = missing.map(r => REQUIREMENT_LABELS[r]).join(' and ');
  return `Upload ${list} to enable.`;
}

function allSlugs() {
  return [SUMMARY_SLUG, ...SPECIALIST_CATEGORIES.flatMap(c => c.slugs)];
}

// ── Tile ──────────────────────────────────────────────────────────────────────

function SpecialistTile({
  slug, tile, isAnyRunning, expandedCards, feedbacks,
  onRun, onToggleCard, onDismiss, onFeedback,
}) {
  const status = tile?.status ?? 'idle';
  const name = SPECIALIST_LABELS[slug] ?? slug;
  const tileClass = `specialist-tile specialist-tile--${status}`;

  return (
    <div className={tileClass}>
      <div className="specialist-tile-header">
        <span className="specialist-tile-name">{name}</span>
        {status === 'cached' && tile.verdicts?.length > 0 && (
          <span className="specialist-tile-badge">
            {tile.verdicts.length}
          </span>
        )}
      </div>

      {status === 'disabled' && (
        <div className="specialist-tile-hint">{tile.disabledReason}</div>
      )}

      {status === 'idle' && (
        <div className="specialist-tile-body">
          <button
            className="specialist-run-btn"
            onClick={() => onRun(slug)}
            disabled={isAnyRunning}
          >
            Run
          </button>
        </div>
      )}

      {status === 'running' && (
        <div className="specialist-tile-body specialist-tile-body--running">
          <EQLoader count={4} height={14} color="var(--cyan)" />
          <span className="specialist-tile-running-label">
            Analyzing… (~10–30 s)
          </span>
        </div>
      )}

      {status === 'cached' && (
        <div className="specialist-tile-body">
          {tile.verdicts.map(v => (
            <VerdictCard
              key={v.verdict_id}
              verdict={v}
              isExpanded={expandedCards.has(v.verdict_id)}
              onToggle={() => onToggleCard(v.verdict_id)}
              onDismiss={onDismiss}
              onFeedback={onFeedback}
              feedback={feedbacks[v.verdict_id]}
            />
          ))}
          <button
            className="specialist-rerun-btn"
            onClick={() => onRun(slug)}
            disabled={isAnyRunning}
          >
            ↺ Re-run
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="specialist-tile-body">
          <div className="specialist-tile-error">{tile.error}</div>
          <button
            className="specialist-retry-btn"
            onClick={() => onRun(slug)}
            disabled={isAnyRunning}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function SpecialistsPanel({ jobId, inputs }) {
  const [tiles, setTiles] = useState(() => {
    const init = {};
    for (const slug of allSlugs()) {
      const reason = missingReason(slug, inputs);
      init[slug] = reason
        ? { status: 'disabled', verdicts: [], disabledReason: reason }
        : { status: 'idle', verdicts: [] };
    }
    return init;
  });
  const [runningSlug, setRunningSlug] = useState(null);
  const [dismissed, setDismissed] = useState(new Set());
  const [feedbacks, setFeedbacks] = useState({});
  const [expandedCards, setExpandedCards] = useState(new Set());

  // Seed cached verdicts on mount
  useEffect(() => {
    let alive = true;
    getVerdicts(jobId).then(payload => {
      if (!alive || !payload?.verdicts?.length) return;
      const grouped = {};
      const fb = {};
      const dis = new Set();
      for (const v of payload.verdicts) {
        (grouped[v.specialist] ??= []).push(v);
        if (v.user_state?.feedback) fb[v.verdict_id] = v.user_state.feedback;
        if (v.user_state?.dismissed) dis.add(v.verdict_id);
      }
      setTiles(prev => {
        const next = { ...prev };
        for (const [slug, vs] of Object.entries(grouped)) {
          if (next[slug]) next[slug] = { status: 'cached', verdicts: vs };
        }
        return next;
      });
      setFeedbacks(fb);
      setDismissed(dis);
    }).catch(() => { /* idle */ });
    return () => { alive = false; };
  }, [jobId]);

  const isAnyRunning = !!runningSlug;

  const handleRun = useCallback(async (slug) => {
    if (runningSlug) return;
    setTiles(prev => {
      if (prev[slug]?.status === 'disabled') return prev;
      return { ...prev, [slug]: { ...prev[slug], status: 'running', error: null } };
    });
    setRunningSlug(slug);
    try {
      const r = await runSpecialist(jobId, slug);
      const verdicts = r.verdicts ?? [];
      const failure = (r.validation_failures ?? [])[0];
      setTiles(prev => ({
        ...prev,
        [slug]: verdicts.length > 0
          ? { status: 'cached', verdicts, lastRunAt: new Date().toISOString() }
          : { status: 'error',
              verdicts: [],
              error: failure?.reason || 'No verdicts returned' },
      }));
    } catch (e) {
      setTiles(prev => ({
        ...prev,
        [slug]: { ...prev[slug], status: 'error',
                  error: e?.message || 'Run failed' },
      }));
    } finally {
      setRunningSlug(null);
    }
  }, [jobId, runningSlug]);

  const handleDismiss = useCallback((id) => {
    setDismissed(prev => new Set([...prev, id]));
    dismissVerdict(id).catch(() => {});
  }, []);

  const handleFeedback = useCallback((id, fb) => {
    setFeedbacks(prev => ({ ...prev, [id]: fb }));
    giveFeedback(id, fb).catch(() => {});
  }, []);

  const toggleCard = useCallback((id) => {
    setExpandedCards(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }, []);

  const summaryTile = tiles[SUMMARY_SLUG];

  return (
    <div className="specialists-panel">
      {/* Header */}
      <div className="specialists-panel-header">
        <div className="specialists-panel-title">
          <div className="specialists-panel-dot" />
          <span>AI SPECIALIST ANALYSIS</span>
        </div>
        <span className="specialists-panel-subtitle mono">
          26 specialists · click to run one
        </span>
      </div>

      {/* Summary CTA */}
      <div className="specialist-summary-cta-wrap">
        <SpecialistTile
          slug={SUMMARY_SLUG}
          tile={summaryTile}
          isAnyRunning={isAnyRunning}
          expandedCards={expandedCards}
          feedbacks={feedbacks}
          onRun={handleRun}
          onToggleCard={toggleCard}
          onDismiss={handleDismiss}
          onFeedback={handleFeedback}
        />
      </div>

      {/* Grouped grid */}
      {SPECIALIST_CATEGORIES.map(group => (
        <div className="specialist-group" key={group.id}>
          <div className="specialist-group-label mono">{group.label}</div>
          <div className="specialists-grid">
            {group.slugs.map(slug => (
              <SpecialistTile
                key={slug}
                slug={slug}
                tile={tiles[slug]}
                isAnyRunning={isAnyRunning}
                expandedCards={expandedCards}
                feedbacks={feedbacks}
                onRun={handleRun}
                onToggleCard={toggleCard}
                onDismiss={handleDismiss}
                onFeedback={handleFeedback}
              />
            ))}
          </div>
        </div>
      ))}

      {dismissed.size > 0 && (
        <div className="specialists-dismissed-note mono">
          {dismissed.size} dismissed
          <button
            onClick={() => setDismissed(new Set())}
            className="specialists-restore-btn"
          >
            restore
          </button>
        </div>
      )}
    </div>
  );
}

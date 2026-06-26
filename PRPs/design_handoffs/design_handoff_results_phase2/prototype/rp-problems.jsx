/* spectre — Problems tab (Tab 4): the de-suppressed verdict list from the live
 * Problem engine. Surfaces all 8 Problem fields:
 *   • dataTier   → grouped into sections (Audio / Stems / Project); empty tiers
 *                  become "unlock" affordances gated on the inputDepth tweak.
 *   • severity → priorityScore → sort order within a group.
 *   • kind       → fault (default) · observation ("FYI") · integrity ("Data").
 *   • source     → "Measured" (rule_engine) vs "AI" (llm_identifier) badge.
 *   • suspected  → soft "Unverified" badge + dashed treatment.
 *   • fixable    → gates the fix CTA (→ Move N, or "generate a fix").
 *   • where      → section anchor chip that deep-links the waveform.
 *   • refines    → child nests beneath its parent verdict. */
const { useState: useStatePr } = React;

// Measured vs AI provenance badge (the `source` enum)
function SourceBadge({ source }) {
  const ai = source === 'llm_identifier';
  return <span className={`pr-srcbadge ${ai ? 'ai' : 'measured'} mono`}>{ai ? 'AI' : 'Measured'}</span>;
}

// where → "◍ Breakdown · 2:33–3:35" deep-link affordance
function WhereChip({ where }) {
  if (!where) return null;
  const t0 = rpFmtTime(where.start_seconds), t1 = rpFmtTime(where.end_seconds);
  const sec = (where.section_type || 'section').replace(/_/g, ' ');
  return (
    <a className="pr-where" href="Listen Page.html" title={`Scrub to ${sec} on the Listen page`}>
      <Icon name="anchor" size={11} />
      <span className="pw-sec">{sec}</span>
      <span className="pw-time mono">{t0}–{t1}</span>
    </a>
  );
}

function ProblemCard({ p, child = false, onGoToMove }) {
  const [showWhy, setShowWhy] = useStatePr(false);
  const isWin = p.sev === 'win';
  const kindMeta = RP_KIND[p.kind] || RP_KIND.fault;
  const dotTone = kindMeta.tone || RP_SEV[p.sev];
  return (
    <div className={`problem fade-up${child ? ' child' : ''}${p.suspected ? ' suspected' : ''}`}
      data-kind={p.kind} data-win={isWin ? 'true' : undefined} style={{ '--sev': RP_SEV[p.sev], '--dot': dotTone }}>
      <div className="pr-main">
        <div className="pr-kick">
          <span className="pr-kind" style={{ color: dotTone }}><Icon name={kindMeta.icon} size={13} /></span>
          <span className="pr-sev">{RP_SEV_LABEL[p.sev]}</span>
          <span className="pr-cat mono">{p.category.replace(/_/g, ' ')}</span>
          {p.suspected && <span className="pr-badge unverified mono">Unverified</span>}
          {kindMeta.label && <span className="pr-badge kind mono">{kindMeta.label}</span>}
          <span className="pr-spacer" />
          {!isWin && <span className="pr-prio mono" title="priorityScore — the authoritative ranking">P{p.priority}</span>}
          <SourceBadge source={p.source} />
        </div>

        <div className="pr-head">{p.headline}</div>
        <div className="pr-sum">{p.summary}</div>

        <div className="pr-evidence">
          <span className="pe-metric mono">{p.evidence.metric}</span>
          <span className="pe-val mono">{p.evidence.value}</span>
          <span className="pe-range mono">expected {p.evidence.range}</span>
          {p.where && <WhereChip where={p.where} />}
        </div>

        <div className="pr-foot">
          <span className="pr-conf mono"><b>{Math.round(p.confidence * 100)}%</b> conf</span>
          <span className="pr-specialist mono">{p.specialist}</span>
          <button className={`linkbtn${showWhy ? ' on' : ''}`} onClick={() => setShowWhy(v => !v)}>why<span className="chev">▾</span></button>
          <span className="foot-spacer" />
          {p.kind === 'observation'
            ? <span className="pr-noaction mono"><Icon name={isWin ? 'check' : 'eye'} size={12} />{isWin ? 'holding up well' : 'informational'}</span>
            : !p.fixable
              ? <span className="pr-noaction mono"><Icon name="layers" size={12} />no auto-fix</span>
              : p.fixMove
                ? <button className="pr-fix" onClick={() => onGoToMove(p.fixMove)}><span className="ar">→</span>Fixed by Move {p.fixMove}</button>
                : <button className="pr-fix ghost" onClick={() => onGoToMove(null)}><Icon name="sparkle" size={12} />Generate a fix</button>}
        </div>

        {showWhy && <div className="pr-why"><span className="q">?</span><span>{p.why}</span></div>}
      </div>
    </div>
  );
}

// One dataTier section: sorted parents with their refined children nested.
function ProblemGroup({ tier, items, onGoToMove }) {
  const byId = {};
  items.forEach(p => { if (p.problemId) byId[p.problemId] = p; });
  const parents = items.filter(p => !p.refines || !byId[p.refines]);
  const childrenOf = (pid) => items.filter(c => c.refines === pid);
  const sorted = [...parents].sort((a, b) => (RP_SEV_RANK[a.sev] - RP_SEV_RANK[b.sev]) || (b.priority - a.priority));
  return (
    <>
      {sorted.map(p => {
        const kids = p.problemId ? childrenOf(p.problemId) : [];
        return (
          <div className={kids.length ? 'pr-thread' : ''} key={p.id}>
            <ProblemCard p={p} onGoToMove={onGoToMove} />
            {kids.map(c => <ProblemCard key={c.id} p={c} child onGoToMove={onGoToMove} />)}
          </div>
        );
      })}
    </>
  );
}

function TierLock({ tier }) {
  return (
    <div className="tier-lock">
      <span className="tl-ic"><Icon name="layers" size={16} /></span>
      <span className="tl-t">{tier.unlock}</span>
      <button className="btn sm">Add files</button>
    </div>
  );
}

function ProblemsTab({ t, onGoToMove }) {
  const degraded = t.state === 'degraded';
  const clean = t.state === 'clean';
  let pool = RP_PROBLEMS;
  if (degraded) pool = pool.filter(p => p.source === 'rule_engine');
  if (clean) pool = pool.filter(p => p.sev === 'win');

  const faultCount = pool.filter(p => rpTierVisible(p.dataTier, t.inputDepth) && p.kind === 'fault' && !p.refines).length;

  return (
    <div className="fade-up">
      <p className="an-intro">
        Every problem the engine found, grouped by <b>where the data came from</b> and ranked by priority. The deterministic rules don&rsquo;t suppress anything &mdash; even the small stuff is here, each linking to the Move that fixes it in <b>Actions</b>.
      </p>

      {degraded && <DegradedBanner />}

      <div className="pr-tally">
        <span className="pt-n mono">{faultCount}</span> {faultCount === 1 ? 'problem needs' : 'problems need'} attention across your inputs
      </div>

      {RP_TIERS.map(tier => {
        const visible = rpTierVisible(tier.id, t.inputDepth);
        const items = pool.filter(p => p.dataTier === tier.id);
        if (clean && items.length === 0) return null;
        return (
          <div key={tier.id} className="pr-tier">
            <SecLabel hint={visible ? `${items.length} ${items.length === 1 ? 'finding' : 'findings'}` : 'locked'}>{tier.label}</SecLabel>
            {!visible
              ? <TierLock tier={tier} />
              : items.length === 0
                ? <div className="pr-cleartier"><Icon name="check" size={14} />Nothing flagged from this input.</div>
                : <ProblemGroup tier={tier} items={items} onGoToMove={onGoToMove} />}
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { ProblemsTab, ProblemCard });

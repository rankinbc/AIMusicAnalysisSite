/* SPECTR — AI Mix Coach
 *
 * The featured experience. Replaces "Overview" as the default Results tab.
 * Each finding is a full-width FeaturedVerdictCard with:
 *   - signed specialist persona (color + label + glyph)
 *   - rank, severity, impact, confidence
 *   - plain-language body
 *   - inline contextual chart (LUFS bar, EQ curve, sidechain envelope, etc.)
 *   - prescriptive Fix recipe with concrete plugin/automation steps
 *   - action row (Apply preset / Mark fixed / 👍 👎 / Snooze)
 */

const { useState: useStateC, useMemo: useMemoC, useEffect: useEffectC, useRef: useRefC } = React;

// ── TranceBot avatar ──────────────────────────────────────────────────────
// Geometric helmet head with a glowing animated visor. Drawn as SVG so it
// scales cleanly. Visor contains a mini EQ animation when "thinking".

function TranceBot({ size = 64, thinking = false, glow = true }) {
  // 5 bar values that drive the visor EQ animation
  const [bars, setBars] = useStateC(() => Array.from({ length: 5 }, () => 0.3));
  const uid = useMemoC(() => Math.random().toString(36).slice(2, 8), []);

  useEffectC(() => {
    let raf, t0 = performance.now() / 1000;
    function frame() {
      const t = performance.now() / 1000 - t0;
      const speed = thinking ? 8 : 2;
      setBars([
        0.3 + (Math.sin(t * speed + 0.2) * 0.5 + 0.5) * 0.65,
        0.3 + (Math.sin(t * speed + 1.1) * 0.5 + 0.5) * 0.65,
        0.3 + (Math.sin(t * speed + 2.0) * 0.5 + 0.5) * 0.65,
        0.3 + (Math.sin(t * speed + 3.3) * 0.5 + 0.5) * 0.65,
        0.3 + (Math.sin(t * speed + 4.7) * 0.5 + 0.5) * 0.65,
      ]);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [thinking]);

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" style={{ display: 'block', filter: glow ? 'drop-shadow(0 0 18px rgba(0,229,176,0.4))' : 'none' }}>
      <defs>
        <linearGradient id={`tb-helmet-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2538" />
          <stop offset="0.5" stopColor="#0d1525" />
          <stop offset="1" stopColor="#070a12" />
        </linearGradient>
        <linearGradient id={`tb-armor-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#070a12" />
          <stop offset="0.5" stopColor="#141f34" />
          <stop offset="1" stopColor="#070a12" />
        </linearGradient>
        <linearGradient id={`tb-visor-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0"   stopColor="#a78bfa" />
          <stop offset="0.5" stopColor="#00e5b0" />
          <stop offset="1"   stopColor="#00e5b0" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id={`tb-cheek-${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#00e5b0" stopOpacity="0.55" />
          <stop offset="1" stopColor="#00e5b0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`tb-horn-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00e5b0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#00e5b0" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Side horns / fins (final-boss silhouette) */}
      <path d="M8 22 L4 14 L11 18 L14 26 Z"  fill={`url(#tb-horn-${uid})`} stroke="rgba(0,229,176,0.5)" strokeWidth="0.8" />
      <path d="M72 22 L76 14 L69 18 L66 26 Z" fill={`url(#tb-horn-${uid})`} stroke="rgba(0,229,176,0.5)" strokeWidth="0.8" />

      {/* Crown antenna stack */}
      <line x1="40" y1="2"  x2="40" y2="10" stroke="#00e5b0" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="40" cy="3" r="2.6" fill="#00e5b0">
        <animate attributeName="opacity" values="0.4;1;0.4" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <rect x="36" y="9" width="8" height="3" rx="1" fill="#11192a" stroke="rgba(0,229,176,0.6)" strokeWidth="0.8" />

      {/* Crown brow plate (gives him a frown / "boss" gaze) */}
      <path d="M14 18 L24 12 L40 10 L56 12 L66 18 L64 22 L58 19 L40 17 L22 19 L16 22 Z"
        fill={`url(#tb-armor-${uid})`}
        stroke="rgba(0,229,176,0.5)" strokeWidth="1" strokeLinejoin="miter" />

      {/* Brow rivets */}
      <circle cx="20" cy="20" r="1.2" fill="rgba(0,229,176,0.7)" />
      <circle cx="60" cy="20" r="1.2" fill="rgba(0,229,176,0.7)" />

      {/* Main helmet — squarer, wider jaw */}
      <path d="M14 22 L24 18 L40 17 L56 18 L66 22 L68 32 L66 48 L60 60 L52 68 L40 70 L28 68 L20 60 L14 48 L12 32 Z"
        fill={`url(#tb-helmet-${uid})`}
        stroke="rgba(0,229,176,0.5)"
        strokeWidth="1.4" strokeLinejoin="miter" />

      {/* Diagonal armor seam lines (sharper / more aggressive) */}
      <path d="M20 60 L26 55 L40 56 L54 55 L60 60" fill="none" stroke="rgba(0,229,176,0.32)" strokeWidth="0.8" />
      <path d="M22 26 L28 22" fill="none" stroke="rgba(0,229,176,0.32)" strokeWidth="0.8" />
      <path d="M58 26 L52 22" fill="none" stroke="rgba(0,229,176,0.32)" strokeWidth="0.8" />

      {/* Side headphone shells — beefier */}
      <rect x="4"  y="30" width="9" height="20" rx="2.5" fill="#11192a" stroke="rgba(0,229,176,0.55)" strokeWidth="1.1" />
      <rect x="6"  y="33" width="5" height="14" rx="1.5" fill="rgba(0,229,176,0.10)" stroke="rgba(0,229,176,0.4)" strokeWidth="0.6" />
      <circle cx="8.5" cy="40" r="2" fill="#00e5b0" />
      <rect x="67" y="30" width="9" height="20" rx="2.5" fill="#11192a" stroke="rgba(167,139,250,0.55)" strokeWidth="1.1" />
      <rect x="69" y="33" width="5" height="14" rx="1.5" fill="rgba(167,139,250,0.10)" stroke="rgba(167,139,250,0.4)" strokeWidth="0.6" />
      <circle cx="71.5" cy="40" r="2" fill="#a78bfa" />

      {/* Visor — narrower, more intense slit with brow ridges */}
      <path d="M16 32 L26 28 L40 27 L54 28 L64 32 L62 42 L56 46 L40 47 L24 46 L18 42 Z"
        fill="#06151a"
        stroke={`url(#tb-visor-${uid})`}
        strokeWidth="1.4" strokeLinejoin="miter" />
      {/* Visor inner contour */}
      <path d="M19 33 L28 30 L40 29 L52 30 L61 33"
        fill="none" stroke="rgba(0,229,176,0.25)" strokeWidth="0.7" />

      {/* Visor EQ bars (animated) */}
      {bars.map((v, i) => {
        const barH = 11 * v;
        const x = 24 + i * 6.5;
        const y = 38 - barH / 2;
        return (
          <rect key={i} x={x} y={y} width="3.5" height={barH} rx="1"
            fill={i === 2 ? '#a78bfa' : '#00e5b0'}
            opacity={0.7 + v * 0.3} />
        );
      })}

      {/* Cheek armor / "speaker" plates */}
      <path d="M16 48 L22 46 L24 56 L18 58 Z" fill={`url(#tb-armor-${uid})`} stroke="rgba(0,229,176,0.3)" strokeWidth="0.7" />
      <path d="M64 48 L58 46 L56 56 L62 58 Z" fill={`url(#tb-armor-${uid})`} stroke="rgba(0,229,176,0.3)" strokeWidth="0.7" />
      <ellipse cx="20" cy="52" rx="3" ry="3.5" fill={`url(#tb-cheek-${uid})`} />
      <ellipse cx="60" cy="52" rx="3" ry="3.5" fill={`url(#tb-cheek-${uid})`} />

      {/* Jaw vent — vertical grille (square jaw, masculine) */}
      <rect x="30" y="54" width="20" height="10" rx="2" fill="#06151a" stroke="rgba(0,229,176,0.4)" strokeWidth="0.9" />
      {Array.from({ length: 5 }).map((_, i) => (
        <line key={i} x1={32 + i * 4} y1="56" x2={32 + i * 4} y2="62"
          stroke="rgba(0,229,176,0.55)" strokeWidth="1.1" strokeLinecap="round" />
      ))}

      {/* Chin guard / mandible point */}
      <path d="M30 64 L34 70 L40 72 L46 70 L50 64" fill={`url(#tb-armor-${uid})`} stroke="rgba(0,229,176,0.5)" strokeWidth="1" strokeLinejoin="miter" />
      <circle cx="40" cy="70" r="1.3" fill="rgba(0,229,176,0.8)" />
    </svg>
  );
}

// ── Mini bot for specialist persona chips ─────────────────────────────────
// Compact octagonal-helmet version (the original TranceBot silhouette).
// Used on specialist cards so the big "boss" up top stays unique.

function MiniBot({ size = 22, color = '#00e5b0' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      {/* Antenna */}
      <line x1="12" y1="1" x2="12" y2="4" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="1.5" r="1.2" fill={color} />
      {/* Octagonal helmet */}
      <path d="M5 6 L7.5 3.5 L16.5 3.5 L19 6 L20.5 9 L20.5 16 L19 19 L16.5 21.5 L7.5 21.5 L5 19 L3.5 16 L3.5 9 Z"
        fill="#0d1525" stroke={color} strokeWidth="1.4" strokeLinejoin="miter" />
      {/* Side audio ports */}
      <rect x="1.5"  y="10" width="2.5" height="5" rx="0.6" fill={color} opacity="0.85" />
      <rect x="20"   y="10" width="2.5" height="5" rx="0.6" fill={color} opacity="0.85" />
      {/* Visor — big and obvious */}
      <rect x="5" y="9" width="14" height="6" rx="1.2" fill="#070a12" stroke={color} strokeWidth="1.1" />
      {/* Eye bar (the glow) */}
      <rect x="6.5" y="10.5" width="11" height="3" rx="0.8" fill={color} />
      {/* Mouth grille */}
      <circle cx="9.5"  cy="18" r="0.95" fill={color} />
      <circle cx="12"   cy="18" r="0.95" fill={color} />
      <circle cx="14.5" cy="18" r="0.95" fill={color} />
    </svg>
  );
}

// ── Coach Chat ────────────────────────────────────────────────────────────
// Inline-expanding chat with TranceBot avatar. Powered by window.claude.complete
// with the full track analysis in context. Strict scoping disclaimer so the
// producer knows where the bot is strong and where it's weak.

const COACH_SUGGESTIONS = [
  "Why am I getting a B+ instead of an A?",
  "Will this pass Spotify normalization?",
  "What's making my low-end muddy?",
  "What's the single biggest issue right now?",
  "How does this compare to other Progressive House?",
  "What did the Loudness specialist find?",
  "If I drop the limiter 3 dB, what changes?",
  "Did my mix improve from v2 to v3?",
];

function buildTrackContext(track) {
  const c = track.coach.map(f => `  - [${f.sev.toUpperCase()}] ${f.title} (${f.metricLine}) — fix: ${f.fix.title}`).join('\n');
  const gaps = track.gap.map(g => `  - ${g.n}: yours ${g.userVal}${g.unit}, genre mean ${g.mean}${g.unit}, range [${g.acceptableRange.join(' to ')}], ${g.inRange ? 'IN RANGE' : g.sev.toUpperCase()}`).join('\n');
  const freq = track.frequency.bands.map(b => `${b.n}=${b.v.toFixed(2)}${b.warn ? '⚠' : ''}`).join(' ');
  return `Track: "${track.name}" · ${track.genre.name} (${track.genre.confidence}% conf) · ${track.bpm} BPM · ${track.key}
Grade: ${track.grade} (${track.score}/100) · Percentile in genre: ${track.percentile}th
Loudness: ${track.loudness.integrated} LUFS integrated, ${track.loudness.truePeak} dBTP true peak, ${track.loudness.dynamicRange} LU dynamic range, ${track.loudness.rms} dB RMS
Stereo: width ${track.stereo.width}%, correlation ${track.stereo.correlation}, mono compat ${Math.round(track.stereo.monoCompat * 100)}%
Frequency bands (0–1): ${freq}
Streaming: ${track.streaming.map(s => `${s.p}@${s.yours}vs${s.target}`).join(', ')}
Arrangement score: ${track.arrangement.score}/100, ${track.arrangement.sections.length} sections, issues: ${track.arrangement.issues.join('; ')}
Genre profile gaps:
${gaps}
Current AI Coach findings (top ${track.coach.length}):
${c}
Specialists run: ${track.coachSummary.specialistsRun}/${track.coachSummary.specialistsTotal}.
Stems uploaded: no. Reference uploaded: no. .als uploaded: no.`;
}

function CoachChat({ track }) {
  const [expanded, setExpanded] = useStateC(false);
  const [messages, setMessages] = useStateC([]);
  const [input, setInput] = useStateC('');
  const [thinking, setThinking] = useStateC(false);
  const [showCapabilities, setShowCapabilities] = useStateC(false);
  const scrollRef = useRefC(null);

  // Auto-scroll on new messages
  useEffectC(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  async function send(rawInput) {
    const q = (rawInput ?? input).trim();
    if (!q || thinking) return;
    if (!expanded) setExpanded(true);
    setInput('');
    const newMessages = [...messages, { role: 'user', text: q }];
    setMessages(newMessages);
    setThinking(true);

    try {
      const ctx = buildTrackContext(track);
      const apiMessages = [
        {
          role: 'user',
          content: `[BACKGROUND — analysis context for the conversation that follows]

${ctx}

You are SPECTR's AI mix coach. Answer the producer's questions concretely using this analysis.

Rules:
- Cite specific metrics from the analysis ("your LUFS is -11.2, which is 2.8 LU hotter than Spotify's -14 target").
- 2–4 sentences typical. Don't lecture or over-explain.
- If a question requires hearing the audio, section-level localized analysis (e.g. exactly which moment), plugin gear recommendations, or perceptual subjective judgments, say so honestly and (if relevant) suggest running an unrun specialist.
- Reference the AI Coach findings by their title when applicable.
- Plain text, no markdown headings.`,
        },
        {
          role: 'assistant',
          content: `Got it — I have the full analysis of "${track.name}" loaded. Ready to answer.`,
        },
        ...newMessages.map(m => ({ role: m.role, content: m.text })),
      ];

      const reply = await window.claude.complete({ messages: apiMessages });
      setMessages(m => [...m, { role: 'assistant', text: reply }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', text: `Sorry, I hit an error answering that (${e?.message || 'unknown'}). Try again in a moment.`, error: true }]);
    } finally {
      setThinking(false);
    }
  }

  function pickSuggestion(s) { send(s); }
  function reset() { setMessages([]); setInput(''); setExpanded(false); }

  return (
    <div style={{
      background: `linear-gradient(135deg, var(--card) 0%, var(--card) 55%, rgba(167,139,250,0.05) 90%, rgba(0,229,176,0.05) 100%)`,
      border: '1px solid rgba(0,229,176,0.22)',
      borderRadius: 14,
      marginBottom: 16,
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Glow accents */}
      <div style={{
        position: 'absolute', top: -40, left: -40, width: 200, height: 200,
        background: 'radial-gradient(circle, rgba(0,229,176,0.20), transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -60, right: -40, width: 220, height: 220,
        background: 'radial-gradient(circle, rgba(167,139,250,0.15), transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{ position: 'relative', padding: expanded ? '16px 22px' : '20px 22px', display: 'flex', alignItems: expanded ? 'center' : 'flex-start', gap: 18, borderBottom: expanded ? '1px solid var(--border)' : 'none' }}>
        <div style={{ flexShrink: 0 }}>
          <TranceBot size={expanded ? 56 : 72} thinking={thinking} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--cyan)', textTransform: 'uppercase', fontWeight: 700 }}>
              ASK THE COACH
            </span>
            <span className="dot" style={{ animation: 'pulseGlow 1.6s ease-in-out infinite' }} />
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>online · trained on your analysis</span>
          </div>
          <div style={{ fontSize: expanded ? 16 : 20, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>
            {expanded
              ? `Coach`
              : `Ask anything about this mix`}
          </div>
          {!expanded && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 0 }}>
              I know everything about <span style={{ color: 'var(--cyan)' }}>{track.name}</span>'s loudness, spectrum, stereo, arrangement, AI specialist findings, and how it ranks vs. {track.genre.name}.
              <button onClick={() => setShowCapabilities(s => !s)} className="mono" style={{
                color: 'var(--violet)', fontSize: 10, letterSpacing: '0.04em',
                marginLeft: 8, padding: 0, textDecoration: 'underline', cursor: 'pointer',
              }}>{showCapabilities ? 'hide scope' : 'what can I ask?'}</button>
            </div>
          )}
        </div>
        {expanded && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={reset} className="btn ghost sm" title="Clear conversation">↺ New chat</button>
            <button onClick={() => setExpanded(false)} className="btn ghost sm" title="Minimize">−</button>
          </div>
        )}
      </div>

      {/* Capabilities expander (collapsed state) */}
      {!expanded && showCapabilities && (
        <CapabilitiesPanel />
      )}

      {/* Collapsed: suggested-prompt chips + go-deeper input */}
      {!expanded && (
        <div style={{ position: 'relative', padding: '0 22px 18px' }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase', margin: '4px 0 10px' }}>
            TRY ASKING
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {COACH_SUGGESTIONS.slice(0, 6).map((s, i) => (
              <button key={i} onClick={() => pickSuggestion(s)} className="mono" style={{
                fontSize: 11, fontWeight: 500,
                padding: '6px 11px', borderRadius: 999,
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid var(--border)',
                color: 'var(--text-2)',
                cursor: 'pointer',
                transition: 'all .15s',
                fontFamily: 'inherit',
              }}
              onMouseOver={e => { e.currentTarget.style.background = 'rgba(0,229,176,0.06)'; e.currentTarget.style.borderColor = 'rgba(0,229,176,0.32)'; e.currentTarget.style.color = 'var(--cyan)'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)'; }}>
                {s}
              </button>
            ))}
          </div>
          <ChatInput input={input} onInput={setInput} onSend={() => send()} thinking={thinking} prominent />
          <ScopeDisclaimer />
        </div>
      )}

      {/* Expanded chat panel */}
      {expanded && (
        <>
          {/* Messages */}
          <div ref={scrollRef} style={{
            position: 'relative',
            maxHeight: 520, overflowY: 'auto',
            padding: '16px 22px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {messages.length === 0 && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>
                — start of conversation —
              </div>
            )}
            {messages.map((m, i) => <ChatBubble m={m} key={i} />)}
            {thinking && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flexShrink: 0 }}><TranceBot size={28} thinking glow={false} /></div>
                <div style={{
                  padding: '10px 14px',
                  background: 'rgba(0,229,176,0.05)',
                  border: '1px solid rgba(0,229,176,0.22)',
                  borderRadius: '10px 10px 10px 2px',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <EQDots count={4} color="var(--cyan)" height={10} />
                  <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>analyzing…</span>
                </div>
              </div>
            )}
          </div>

          {/* Suggested prompts (compact) */}
          {messages.length < 4 && (
            <div style={{ padding: '0 22px 10px', position: 'relative' }}>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                {COACH_SUGGESTIONS.slice(0, 5).map((s, i) => (
                  <button key={i} onClick={() => pickSuggestion(s)} className="mono" disabled={thinking} style={{
                    fontSize: 10, padding: '5px 10px', borderRadius: 999,
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    cursor: 'pointer', flexShrink: 0,
                    fontFamily: 'inherit',
                    opacity: thinking ? 0.5 : 1,
                  }}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {/* Input bar */}
          <div style={{ padding: '12px 22px 16px', borderTop: '1px solid var(--border)', position: 'relative' }}>
            <ChatInput input={input} onInput={setInput} onSend={() => send()} thinking={thinking} prominent />
            <ScopeDisclaimer />
          </div>
        </>
      )}
    </div>
  );
}

function ChatBubble({ m }) {
  const isUser = m.role === 'user';
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-end' }}>
      {!isUser && (
        <div style={{ flexShrink: 0 }}>
          <TranceBot size={28} thinking={false} glow={false} />
        </div>
      )}
      <div style={{
        maxWidth: '78%',
        padding: '10px 14px',
        background: isUser ? 'rgba(167,139,250,0.10)' : m.error ? 'rgba(244,63,94,0.08)' : 'rgba(0,229,176,0.05)',
        border: isUser ? '1px solid rgba(167,139,250,0.32)' : m.error ? '1px solid rgba(244,63,94,0.30)' : '1px solid rgba(0,229,176,0.22)',
        borderRadius: isUser ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
        fontSize: 13, color: 'var(--text)', lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {m.text}
      </div>
      {isUser && (
        <div style={{
          flexShrink: 0,
          width: 28, height: 28, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--cyan) 0%, var(--violet) 100%)',
          color: '#06151a', display: 'grid', placeItems: 'center',
          fontWeight: 800, fontSize: 11,
        }}>M</div>
      )}
    </div>
  );
}

function ChatInput({ input, onInput, onSend, thinking, prominent }) {
  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }
  return (
    <div style={{
      display: 'flex', gap: 8,
      padding: prominent ? '10px 12px' : '8px 10px',
      background: 'rgba(7,10,18,0.5)',
      border: `1px solid ${input ? 'rgba(0,229,176,0.32)' : 'var(--border)'}`,
      borderRadius: 9,
      transition: 'border-color .15s',
    }}>
      <input
        value={input}
        onChange={e => onInput(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Ask about loudness, frequencies, fixes, comparisons…"
        disabled={thinking}
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
        }} />
      <button onClick={onSend} disabled={!input || thinking} className="btn primary sm" style={{
        opacity: !input || thinking ? 0.5 : 1, padding: '4px 14px',
      }}>
        {thinking ? '…' : 'Ask →'}
      </button>
    </div>
  );
}

function ScopeDisclaimer() {
  return (
    <div className="mono" style={{
      fontSize: 9.5, color: 'var(--dim)', marginTop: 8,
      lineHeight: 1.55, letterSpacing: '0.02em',
      display: 'flex', alignItems: 'flex-start', gap: 6,
    }}>
      <span style={{ color: 'var(--muted)' }}>ⓘ</span>
      <span>
        The Coach reads this track's analysis — loudness, spectrum, stereo, arrangement, AI specialist findings, genre profile. It <span style={{ color: 'var(--muted)' }}>can't</span> hear the audio, locate moments in time, or recommend specific plugin brands.
      </span>
    </div>
  );
}

function CapabilitiesPanel() {
  const good = [
    'Why am I getting this grade?',
    'Is my low end too heavy?',
    'How do I get a louder master?',
    'How does this compare to commercial Prog House?',
    'What did the Loudness specialist find?',
    'What\'s the biggest issue?',
  ];
  const weak = [
    'Why does the chorus feel weak?',
    'Where exactly is the harshness?',
    'Should I use FabFilter or iZotope?',
    'Why does this synth feel cheap?',
    'How does the actual audio sound?',
  ];
  return (
    <div style={{
      position: 'relative',
      margin: '0 22px 14px',
      padding: 14,
      borderRadius: 10,
      background: 'rgba(255,255,255,0.018)',
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--cyan)', textTransform: 'uppercase', marginBottom: 8 }}>
            ✓ Strong here
          </div>
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {good.map((g, i) => (
              <li key={i} style={{ fontSize: 11, color: 'var(--text-2)', display: 'flex', gap: 6 }}>
                <span style={{ color: 'var(--cyan)' }}>·</span><span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--orange)', textTransform: 'uppercase', marginBottom: 8 }}>
            ✗ Falls flat here
          </div>
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {weak.map((g, i) => (
              <li key={i} style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 6 }}>
                <span style={{ color: 'var(--orange)' }}>·</span><span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────

function AICoachTab({ track }) {
  const [categoryFilter, setCategoryFilter] = useStateC('all');
  const [showFixed, setShowFixed] = useStateC(false);
  const [statuses, setStatuses] = useStateC({}); // id → 'fixed'|'snoozed'

  const visible = useMemoC(() => {
    return track.coach.filter(f => {
      if (!showFixed && statuses[f.id]) return false;
      if (categoryFilter === 'all') return true;
      const persona = window.SPECTR_PERSONAS[f.specialist];
      return persona && persona.label === categoryFilter;
    });
  }, [track.coach, categoryFilter, showFixed, statuses]);

  const onMarkFixed = (id) => setStatuses(s => ({ ...s, [id]: 'fixed' }));
  const onSnooze    = (id) => setStatuses(s => ({ ...s, [id]: 'snoozed' }));

  return (
    <div>
      <CoachChat track={track} />
      <CoachFilters
        track={track}
        categoryFilter={categoryFilter}
        onCategoryFilter={setCategoryFilter}
        showFixed={showFixed}
        onShowFixed={setShowFixed}
        fixedCount={Object.values(statuses).filter(s => s === 'fixed').length}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 22 }}>
        {visible.map(f => (
          <FeaturedVerdictCard
            key={f.id}
            verdict={f}
            status={statuses[f.id]}
            onMarkFixed={() => onMarkFixed(f.id)}
            onSnooze={() => onSnooze(f.id)}
          />
        ))}
        {visible.length === 0 && (
          <div className="card card-body" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
            No findings match this filter.
          </div>
        )}
      </div>

      <AllSpecialistsRoster track={track} />
    </div>
  );
}

// ── Coach hero — summary statement + run-all CTA ──────────────────────────

function CoachHero({ track }) {
  const s = track.coachSummary;
  const sev = s.critical > 0 ? 'critical' : s.warning > 0 ? 'warning' : 'info';
  const accentColor = sev === 'critical' ? 'var(--red)' : sev === 'warning' ? 'var(--orange)' : 'var(--cyan)';
  const headline = s.critical > 0
    ? `${s.critical} critical issue${s.critical === 1 ? '' : 's'} blocking release`
    : s.warning > 0
    ? `${s.warning} warning${s.warning === 1 ? '' : 's'} worth fixing before release`
    : 'No issues — release-ready';

  return (
    <div className="card" style={{
      marginBottom: 16,
      overflow: 'hidden',
      position: 'relative',
      background: `linear-gradient(135deg, var(--card) 0%, var(--card) 60%, ${accentColor}0a 100%)`,
    }}>
      {/* Decorative bg waveform */}
      <div style={{
        position: 'absolute', right: -40, top: 0, bottom: 0,
        width: 360, opacity: 0.35,
        pointerEvents: 'none',
        background: 'radial-gradient(ellipse 80% 60% at 70% 50%, rgba(0,229,176,0.08), transparent 65%)',
      }} />
      <div style={{ padding: '22px 26px', display: 'flex', alignItems: 'center', gap: 22, position: 'relative' }}>
        <CoachAvatar />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase' }}>AI MIX COACH</span>
            <span className="pill cyan" style={{ fontSize: 9 }}>{s.specialistsRun}/{s.specialistsTotal} specialists run</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text)' }}>{headline}</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
            <SevSummary label="Critical" count={s.critical} color="var(--red)" />
            <SevSummary label="Warnings"  count={s.warning}  color="var(--orange)" />
            <SevSummary label="Info"      count={s.info}     color="var(--cyan)" />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <button className="btn primary" style={{ padding: '9px 18px' }}>
            <EQDots count={3} color="#06151a" height={10} />
            <span style={{ marginLeft: 6 }}>Run {s.specialistsTotal - s.specialistsRun} remaining</span>
          </button>
          <button className="btn sm ghost" style={{ color: 'var(--muted)' }}>↗ Export fix list as PDF</button>
        </div>
      </div>
    </div>
  );
}

function SevSummary({ label, count, color }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 12px',
      background: `${color}0a`,
      border: `1px solid ${color}28`,
      borderRadius: 7,
    }}>
      <span className="mono" style={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1 }}>{count}</span>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color, textTransform: 'uppercase', opacity: 0.9 }}>{label}</span>
    </div>
  );
}

function CoachAvatar() {
  return (
    <div style={{
      width: 56, height: 56, borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(0,229,176,0.22), rgba(167,139,250,0.18))',
      border: '1px solid rgba(0,229,176,0.4)',
      boxShadow: 'inset 0 0 20px rgba(0,229,176,0.18), 0 0 24px -10px rgba(0,229,176,0.5)',
      display: 'grid', placeItems: 'center',
      flexShrink: 0,
      position: 'relative',
    }}>
      <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
        <rect x="4"  y="14" width="3.2" height="11" rx="1" fill="#00e5b0" opacity="0.55" />
        <rect x="10" y="9"  width="3.2" height="16" rx="1" fill="#00e5b0" opacity="0.85" />
        <rect x="16" y="4"  width="3.2" height="21" rx="1" fill="#00e5b0" />
        <rect x="22" y="11" width="3.2" height="14" rx="1" fill="#a78bfa" opacity="0.85" />
        <rect x="28" y="15" width="3.2" height="10" rx="1" fill="#a78bfa" opacity="0.55" />
      </svg>
    </div>
  );
}

// ── Filter strip ──────────────────────────────────────────────────────────

function CoachFilters({ track, categoryFilter, onCategoryFilter, showFixed, onShowFixed, fixedCount }) {
  // Build category counts from coach findings
  const cats = useMemoC(() => {
    const counts = {};
    for (const f of track.coach) {
      const p = window.SPECTR_PERSONAS[f.specialist];
      if (!p) continue;
      counts[p.label] = (counts[p.label] || 0) + 1;
    }
    return Object.entries(counts).map(([label, count]) => {
      // find a color
      const persona = Object.values(window.SPECTR_PERSONAS).find(p => p.label === label);
      return { label, count, color: persona?.color || 'var(--cyan)' };
    });
  }, [track.coach]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      marginBottom: 16, flexWrap: 'wrap',
    }}>
      <CategoryChip label="All" count={track.coach.length} active={categoryFilter === 'all'} onClick={() => onCategoryFilter('all')} color="var(--cyan)" />
      {cats.map(c => (
        <CategoryChip key={c.label} label={c.label} count={c.count}
          active={categoryFilter === c.label}
          onClick={() => onCategoryFilter(c.label)}
          color={c.color} />
      ))}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {fixedCount > 0 && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--green)' }}>✓ {fixedCount} fixed</span>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showFixed} onChange={e => onShowFixed(e.target.checked)}
            style={{ accentColor: 'var(--cyan)' }} />
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>Show fixed</span>
        </label>
      </div>
    </div>
  );
}

function CategoryChip({ label, count, active, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 12px', borderRadius: 7,
      background: active ? `${color}12` : 'rgba(255,255,255,0.025)',
      border: `1px solid ${active ? `${color}50` : 'var(--border)'}`,
      transition: 'all .15s ease',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: active ? `0 0 8px ${color}` : 'none' }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: active ? 'var(--text)' : 'var(--text-2)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 10, color: active ? color : 'var(--muted)' }}>{count}</span>
    </button>
  );
}

// ── Featured verdict card ─────────────────────────────────────────────────

function FeaturedVerdictCard({ verdict, status, onMarkFixed, onSnooze }) {
  const persona = window.SPECTR_PERSONAS[verdict.specialist] || { label: 'GENERAL', color: 'var(--cyan)', glyph: '?' };
  const sev = status === 'fixed' ? 'fixed' : verdict.sev;
  const sevColors = {
    critical: 'var(--red)',
    warning:  'var(--orange)',
    info:     'var(--cyan)',
    fixed:    'var(--green)',
  };
  const c = sevColors[sev];
  const isFixed = status === 'fixed';

  return (
    <div style={{
      background: `linear-gradient(180deg, ${c}06 0%, var(--card) 70%)`,
      border: `1px solid ${c}22`,
      borderLeft: `3px solid ${c}`,
      borderRadius: 12,
      overflow: 'hidden',
      opacity: status === 'snoozed' ? 0.45 : 1,
      position: 'relative',
    }}>
      {/* Atmospheric rank numeral */}
      <div style={{
        position: 'absolute', right: 28, top: 14, pointerEvents: 'none',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 88, fontWeight: 700, lineHeight: 1,
        color: c, opacity: 0.06,
        letterSpacing: '-0.02em',
      }}>
        {String(verdict.rank).padStart(2, '0')}
      </div>

      <div style={{ padding: '18px 22px' }}>
        {/* Header — specialist persona + rank + sev + impact + confidence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <PersonaChip persona={persona} />
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em' }}>
            FINDING <span style={{ color: c }}>#{String(verdict.rank).padStart(2, '0')}</span>
          </span>
          <SevPill sev={sev} />
          <ImpactTag impact={verdict.impact} />
          <ConfidenceMeter value={verdict.confidence} />
          {isFixed && <span className="pill green">✓ Fixed</span>}
        </div>

        {/* Title */}
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.25, marginBottom: 10, maxWidth: '88%' }}>
          {verdict.title}
        </div>

        {/* Body */}
        <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, maxWidth: 720, marginBottom: 16 }}>
          {verdict.body}
        </div>

        {/* Metric line */}
        <div className="mono" style={{
          display: 'inline-block',
          fontSize: 10.5, letterSpacing: '0.06em',
          color: c, padding: '5px 10px',
          background: `${c}10`, border: `1px solid ${c}28`,
          borderRadius: 5, marginBottom: 14,
        }}>
          {verdict.metricLine}
        </div>

        {/* Inline chart banner */}
        <InlineChart type={verdict.chartType} verdict={verdict} sevColor={c} />

        {/* Fix recipe */}
        <FixRecipe fix={verdict.fix} presetName={verdict.presetName} sevColor={c} />

        {/* Actions */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)',
        }}>
          <button className="btn primary sm" disabled={isFixed} style={isFixed ? { opacity: 0.5 } : {}}>
            <span style={{ fontSize: 11 }}>◆</span>
            Apply preset
          </button>
          {!isFixed ? (
            <button className="btn sm" onClick={onMarkFixed}>✓ Mark fixed</button>
          ) : (
            <button className="btn sm">↺ Re-open</button>
          )}
          <button className="btn ghost sm" onClick={onSnooze} style={{ color: 'var(--muted)' }}>Snooze</button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4 }}>helpful?</span>
            <button className="btn ghost sm" style={{ padding: '4px 8px', color: 'var(--muted)' }}>👍</button>
            <button className="btn ghost sm" style={{ padding: '4px 8px', color: 'var(--muted)' }}>👎</button>
            <button className="btn ghost sm" style={{ padding: '4px 10px', marginLeft: 6, color: 'var(--muted)' }}>Why this?</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Persona chip + sev pill + impact tag + confidence meter ───────────────

function PersonaChip({ persona }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px 4px 4px', borderRadius: 999,
      background: `${persona.color}10`,
      border: `1px solid ${persona.color}30`,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: `${persona.color}1a`,
        border: `1px solid ${persona.color}66`,
        display: 'grid', placeItems: 'center',
        flexShrink: 0,
      }}>
        <MiniBot size={20} color={persona.color} />
      </div>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: persona.color, fontWeight: 600 }}>
        {persona.label}
      </span>
    </div>
  );
}

function SevPill({ sev }) {
  const map = {
    critical: { label: 'CRITICAL', color: 'var(--red)' },
    warning:  { label: 'WARNING',  color: 'var(--orange)' },
    info:     { label: 'INFO',     color: 'var(--cyan)' },
    fixed:    { label: 'FIXED',    color: 'var(--green)' },
  };
  const m = map[sev] || map.info;
  return <span className="pill" style={{ color: m.color, borderColor: `${m.color}44`, background: `${m.color}10`, fontWeight: 700, letterSpacing: '0.12em' }}>{m.label}</span>;
}

function ImpactTag({ impact }) {
  const map = {
    high: { label: '↑↑ HIGH IMPACT', color: 'var(--orange)' },
    med:  { label: '↑ MED IMPACT',   color: 'var(--yellow)' },
    low:  { label: '· LOW IMPACT',   color: 'var(--muted)' },
  };
  const m = map[impact] || map.med;
  return <span className="mono" style={{ fontSize: 10, color: m.color, letterSpacing: '0.10em' }}>{m.label}</span>;
}

function ConfidenceMeter({ value }) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
      <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>confidence</span>
      <div style={{ width: 36, height: 4, background: 'var(--dim)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--cyan)', borderRadius: 2 }} />
      </div>
      <span className="mono" style={{ fontSize: 10, color: 'var(--cyan)', fontWeight: 600 }}>{pct}%</span>
    </div>
  );
}

// ── Inline chart variants ─────────────────────────────────────────────────

function InlineChart({ type, verdict, sevColor }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'rgba(0,0,0,0.18)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      marginBottom: 14,
    }}>
      {type === 'lufs'        && <LUFSInline sevColor={sevColor} />}
      {type === 'frequency'   && <FrequencyInline sevColor={sevColor} />}
      {type === 'eq-curve'    && <EQCurveInline sevColor={sevColor} />}
      {type === 'sidechain'   && <SidechainInline sevColor={sevColor} />}
      {type === 'arrangement' && <ArrangementInline sevColor={sevColor} />}
      {type === 'stems'       && <StemsInline sevColor={sevColor} />}
    </div>
  );
}

function LUFSInline({ sevColor }) {
  const lufs = -11.2;
  const targets = [
    { v: -16, label: 'Apple',   color: 'var(--violet)' },
    { v: -14, label: 'Spotify', color: 'var(--cyan)' },
    { v: -10.8, label: 'Genre median', color: 'rgba(255,255,255,0.5)' },
  ];
  const min = -24, max = 0;
  const toPct = v => `${((v - min) / (max - min)) * 100}%`;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="label">LOUDNESS vs STREAMING TARGETS</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>−24 LUFS → 0 LUFS</span>
      </div>
      <div style={{ position: 'relative', height: 36, background: 'var(--dim)', borderRadius: 5, marginBottom: 18 }}>
        {/* zones */}
        <div style={{ position: 'absolute', left: toPct(-14), right: 0, top: 0, bottom: 0, background: 'rgba(244,63,94,0.10)', borderRadius: 5 }} />
        {/* fill */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: toPct(lufs),
          background: sevColor, borderRadius: 5,
          boxShadow: `0 0 12px ${sevColor}66`,
        }} />
        {/* current value indicator */}
        <div style={{ position: 'absolute', left: toPct(lufs), top: -8, transform: 'translateX(-50%)' }}>
          <div className="mono" style={{
            background: sevColor, color: '#06151a',
            padding: '2px 7px', borderRadius: 4,
            fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
          }}>{lufs} LUFS</div>
        </div>
        {/* target markers */}
        {targets.map(t => (
          <div key={t.label} style={{ position: 'absolute', left: toPct(t.v), top: 0, bottom: 0 }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: t.color, transform: 'translateX(-50%)' }} />
            <div className="mono" style={{
              position: 'absolute', bottom: -16, left: 0, transform: 'translateX(-50%)',
              fontSize: 9, color: t.color, whiteSpace: 'nowrap',
            }}>
              {t.label} {t.v}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FrequencyInline({ sevColor }) {
  const bands = [
    { n: 'SUB',  v: 0.62 }, { n: 'BASS',  v: 0.88, warn: true },
    { n: 'L.MID', v: 0.71 }, { n: 'MID',   v: 0.64 },
    { n: 'H.MID', v: 0.58 }, { n: 'PRES',  v: 0.52 },
    { n: 'BRIL', v: 0.46 }, { n: 'AIR',   v: 0.32, warn: true },
  ];
  const median = [0.58, 0.74, 0.69, 0.67, 0.60, 0.55, 0.50, 0.42];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="label">FREQUENCY BALANCE vs GENRE MEDIAN</span>
        <div style={{ display: 'flex', gap: 12 }}>
          <Legend2 swatch="var(--cyan)" label="your track" />
          <Legend2 swatch="rgba(255,255,255,0.22)" label="genre median" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 80 }}>
        {bands.map((b, i) => (
          <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 5 }}>
            <div style={{ width: '100%', height: 60, position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: `${median[i] * 100}%`,
                background: 'rgba(255,255,255,0.10)',
                borderRadius: '3px 3px 0 0',
              }} />
              <div className="fill-h" style={{
                width: '100%', height: `${b.v * 100}%`,
                borderRadius: '3px 3px 0 0',
                background: b.warn
                  ? `linear-gradient(to top, ${sevColor}, ${sevColor}22)`
                  : 'linear-gradient(to top, var(--cyan), rgba(0,229,176,0.22))',
                boxShadow: b.warn ? `0 0 6px ${sevColor}55` : 'none',
                position: 'relative',
                animationDelay: `${i * 0.05}s`,
              }} />
              {b.warn && <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: sevColor }}>▲</div>}
            </div>
            <div className="mono" style={{ fontSize: 8, color: b.warn ? sevColor : 'var(--muted)', letterSpacing: '0.04em' }}>{b.n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend2({ swatch, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 14, height: 3, background: swatch, borderRadius: 1.5 }} />
      <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>{label}</span>
    </div>
  );
}

function EQCurveInline({ sevColor }) {
  // Draw a flat line with a high-shelf lift starting at ~10kHz
  const W = 600, H = 92;
  const points = [];
  for (let i = 0; i <= 100; i++) {
    const x = (i / 100) * W;
    const freqRatio = i / 100;
    // shelf at 0.78 (12kHz)
    const lift = freqRatio > 0.65 ? Math.min(1, (freqRatio - 0.65) / 0.2) * 14 : 0;
    const y = H / 2 - lift;
    points.push(`${x},${y}`);
  }
  const path = `M ${points.join(' L ')}`;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="label">RECOMMENDED EQ ADJUSTMENT</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--cyan)' }}>+2 dB high-shelf @ 12 kHz</span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {/* grid */}
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <line key={v} x1={v * W} y1={0} x2={v * W} y2={H} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        ))}
        <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 3" />
        {/* fill under curve relative to flat */}
        <path d={`${path} L ${W},${H/2} L 0,${H/2} Z`} fill="var(--cyan)" opacity="0.18" />
        {/* curve */}
        <path d={path} stroke="var(--cyan)" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* shelf marker */}
        <circle cx={W * 0.78} cy={H / 2 - 14} r="4" fill="var(--cyan)" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {['20Hz', '120Hz', '1kHz', '6kHz', '20kHz'].map((l, i) => (
          <span key={i} className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function SidechainInline({ sevColor }) {
  // Visualize the sidechain envelope: kick triggers a gain drop every beat
  const W = 600, H = 90;
  const beats = 4;
  const points = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const localBeat = (t * beats) % 1;
    // attack 8ms (~0.02), release 80ms (~0.1)
    let g = 1;
    if (localBeat < 0.04) g = 1 - (localBeat / 0.04) * 0.7; // fast duck
    else if (localBeat < 0.30) g = 0.3 + ((localBeat - 0.04) / 0.26) * 0.7; // release
    const x = t * W;
    const y = H - g * (H - 8) - 4;
    points.push(`${x},${y}`);
  }
  const path = `M ${points.join(' L ')}`;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="label">SIDECHAIN ENVELOPE · SUB GAIN</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--violet)' }}>−6 dB · 8 ms attack · 80 ms release</span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {/* beat triggers */}
        {Array.from({ length: beats }).map((_, i) => (
          <line key={i} x1={(i / beats) * W} y1={0} x2={(i / beats) * W} y2={H}
            stroke="rgba(244,63,94,0.35)" strokeWidth="1.2" strokeDasharray="3 3" />
        ))}
        {/* envelope fill */}
        <path d={`${path} L ${W},${H} L 0,${H} Z`} fill="var(--violet)" opacity="0.18" />
        {/* curve */}
        <path d={path} stroke="var(--violet)" strokeWidth="2" fill="none" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {Array.from({ length: beats }).map((_, i) => (
          <span key={i} className="mono" style={{ fontSize: 9, color: 'var(--red)' }}>▲ kick {i + 1}</span>
        ))}
      </div>
    </div>
  );
}

function ArrangementInline({ sevColor }) {
  const sections = [
    { t: 'intro',     l: 'Intro',     bars: 16, energy: 0.28 },
    { t: 'buildup',   l: 'Build A',   bars: 16, energy: 0.55, lift: true },
    { t: 'drop',      l: 'Drop A',    bars: 32, energy: 0.92 },
    { t: 'breakdown', l: 'Breakdown', bars: 32, energy: 0.30, flag: true },
    { t: 'buildup',   l: 'Build B',   bars: 16, energy: 0.55 },
    { t: 'drop',      l: 'Drop B',    bars: 32, energy: 0.92 },
    { t: 'outro',     l: 'Outro',     bars: 16, energy: 0.20 },
  ];
  const total = sections.reduce((s, x) => s + x.bars, 0);
  const colors = {
    intro: 'rgba(255,255,255,0.08)',
    buildup: 'rgba(0,229,176,0.32)',
    drop: 'rgba(251,146,60,0.55)',
    breakdown: 'rgba(167,139,250,0.45)',
    outro: 'rgba(255,255,255,0.08)',
  };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="label">ARRANGEMENT · ENERGY OVER BARS</span>
        <span className="mono" style={{ fontSize: 10, color: sevColor }}>flagged: breakdown drop ▲</span>
      </div>
      {/* Section ribbon */}
      <div style={{ display: 'flex', gap: 2, height: 18, marginBottom: 4 }}>
        {sections.map((s, i) => (
          <div key={i} style={{
            width: `${(s.bars / total) * 100}%`,
            background: colors[s.t] || 'rgba(255,255,255,0.06)',
            borderRadius: 3,
            position: 'relative',
            border: s.flag ? `1px solid ${sevColor}88` : '1px solid transparent',
          }}>
            <span className="mono" style={{
              position: 'absolute', left: 5, top: 1,
              fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.85)',
            }}>{s.l}</span>
          </div>
        ))}
      </div>
      {/* Energy bars */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 56 }}>
        {sections.map((s, i) => (
          <div key={i} style={{
            width: `${(s.bars / total) * 100}%`,
            height: `${s.energy * 100}%`,
            background: s.flag ? sevColor : 'linear-gradient(to top, var(--cyan), rgba(0,229,176,0.3))',
            borderRadius: '3px 3px 0 0',
            position: 'relative',
          }}>
            {s.flag && (
              <div style={{
                position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)',
                fontSize: 9, color: sevColor, fontFamily: 'JetBrains Mono, monospace',
                whiteSpace: 'nowrap',
              }}>−8 LUFS / 4 bars</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StemsInline({ sevColor }) {
  const clashes = [
    { a: 'Kick', b: 'Bass',    range: '80–180 Hz', pct: 38, sev: 'severe' },
    { a: 'Lead', b: 'Pad',     range: '1.5–3 kHz', pct: 26, sev: 'moderate' },
    { a: 'Vocal',b: 'Cymbals', range: '8–12 kHz',  pct: 22, sev: 'moderate' },
  ];
  return (
    <div>
      <span className="label" style={{ marginBottom: 10, display: 'block' }}>STEM SPECTRAL OVERLAP</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {clashes.map((c, i) => {
          const col = c.sev === 'severe' ? sevColor : 'var(--orange)';
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, width: 110 }}>{c.a} <span style={{ color: 'var(--muted)' }}>×</span> {c.b}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', width: 90 }}>{c.range}</span>
              <div style={{ flex: 1, height: 5, background: 'var(--dim)', borderRadius: 3, overflow: 'hidden' }}>
                <div className="fill-w" style={{ height: '100%', width: `${c.pct}%`, background: col, boxShadow: `0 0 4px ${col}` }} />
              </div>
              <span className="mono" style={{ fontSize: 10, color: col, width: 36, textAlign: 'right' }}>{c.pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Fix recipe ────────────────────────────────────────────────────────────

function FixRecipe({ fix, presetName, sevColor }) {
  return (
    <div style={{
      background: 'rgba(0,229,176,0.04)',
      border: '1px solid rgba(0,229,176,0.22)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px',
        background: 'rgba(0,229,176,0.06)',
        borderBottom: '1px solid rgba(0,229,176,0.18)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 12, color: 'var(--cyan)' }}>◆</span>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--cyan)', textTransform: 'uppercase' }}>The fix</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{fix.title}</span>
        <span className="pill cyan" style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700 }}>
          preset · {presetName}
        </span>
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {fix.steps.map((s, i) => <FixStep step={s} i={i} key={i} />)}
        </div>
        <div style={{
          marginTop: 12, padding: '10px 12px',
          borderRadius: 7, background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55,
          fontStyle: 'italic',
          display: 'flex', gap: 10,
        }}>
          <span style={{ color: 'var(--muted)', flexShrink: 0 }}>Why?</span>
          <span>{fix.why}</span>
        </div>
      </div>
    </div>
  );
}

const KIND_GLYPH = {
  plugin:       { glyph: 'P', color: 'var(--cyan)',   label: 'PLUGIN' },
  automation:   { glyph: 'A', color: 'var(--violet)', label: 'AUTOMATION' },
  arrangement:  { glyph: 'S', color: 'var(--violet)', label: 'STRUCTURE' },
  fx:           { glyph: 'F', color: 'var(--yellow)', label: 'FX' },
  target:       { glyph: 'T', color: 'var(--green)',  label: 'TARGET' },
  check:        { glyph: 'C', color: 'var(--muted)',  label: 'CHECK' },
  production:   { glyph: 'M', color: 'var(--orange)', label: 'MUSIC' },
};

function FixStep({ step, i }) {
  const k = KIND_GLYPH[step.kind] || KIND_GLYPH.plugin;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', width: 14 }}>{i + 1}.</span>
      <div style={{
        width: 22, height: 22, borderRadius: 5,
        display: 'grid', placeItems: 'center',
        background: `${k.color}14`, border: `1px solid ${k.color}40`,
        color: k.color, fontSize: 10, fontWeight: 700, flexShrink: 0,
      }}>{k.glyph}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.10em', color: k.color, textTransform: 'uppercase', minWidth: 78 }}>
          {k.label}
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{step.where}</span>
        <span style={{ fontSize: 12, color: 'var(--text)' }}>{step.what}</span>
        {step.from && step.to && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--muted)' }}>{step.from}</span>
            <span style={{ color: 'var(--cyan)' }}>→</span>
            <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{step.to}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── All 26 specialists roster (below the featured findings) ──────────────

function AllSpecialistsRoster({ track }) {
  const [open, setOpen] = useStateC(false);
  return (
    <div className="card">
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', textAlign: 'left',
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: open ? '1px solid var(--border)' : 'none',
      }}>
        <SectionTitle accent="var(--cyan)" style={{ marginBottom: 0 }}>
          All {SPECIALIST_GROUPS_STATS.total} specialists ·
          <span style={{ color: 'var(--text-2)' }}> {SPECIALIST_GROUPS_STATS.cached} run</span>
          <span style={{ color: 'var(--violet)' }}> · {SPECIALIST_GROUPS_STATS.running} running</span>
        </SectionTitle>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {SPECIALIST_GROUPS.map(g => (
            <div key={g.id}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                {g.label}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 8 }}>
                {g.items.map(item => <SpecialistTileFull key={item.slug} item={item} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

window.AICoachTab = AICoachTab;

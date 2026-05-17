import { useState } from 'react';
import { toast } from 'sonner';

import { TranceBot } from './TranceBot';
import s from './CoachChat.module.css';

interface CoachChatProps {
  trackName: string;
}

const SUGGESTIONS = [
  'Why am I getting a B instead of an A?',
  'Will this pass Spotify normalization?',
  "What's making my low-end muddy?",
  "What's the single biggest issue right now?",
  'How does this compare to other Progressive House?',
  'What did the Loudness specialist find?',
];

const STRONG = [
  'Mix balance and frequency',
  'Loudness and streaming targets',
  'Specialist findings & priorities',
  'Genre-comparative analysis',
];

const WEAK = [
  'Subjective taste and vibe',
  'Mastering chain plugin specifics',
  'Real-time playback rendering',
  'Live arrangement experiments',
];

export function CoachChat({ trackName }: CoachChatProps) {
  const [input, setInput] = useState('');
  const [showCaps, setShowCaps] = useState(false);

  const send = () => {
    if (!input.trim()) return;
    toast.info('Coach chat not wired yet — coming in the next slice.');
    setInput('');
  };

  return (
    <section className={s.coach}>
      <div className={s.body}>
        <div className={s.avatar}>
          <TranceBot size={72} thinking={false} />
        </div>
        <div className={s.text}>
          <div className={s.statusRow}>
            <span className="dot pulse-soft" />
            <span className={s.statusLabel}>Ask the coach</span>
            <span className={s.statusSub}>online · trained on your analysis</span>
          </div>
          <h3 className={s.title}>Ask anything about this mix</h3>
          <p className={s.subtitle}>
            I&rsquo;ve seen every metric on <strong>{trackName || 'this track'}</strong>, every
            specialist verdict, and how it compares to your genre&rsquo;s reference profile.
            Ask me what to fix first, what would push you up a grade, or why a specialist
            flagged what it did.{' '}
            <button
              type="button"
              className={s.capabilitiesLink}
              onClick={() => setShowCaps((v) => !v)}
            >
              {showCaps ? 'hide' : 'what can I ask?'}
            </button>
          </p>

          {showCaps && (
            <div className={s.capabilities}>
              <div className={s.capabilitiesCol}>
                <h4 style={{ color: 'var(--cyan)' }}>Strong here</h4>
                <ul className={s.capabilitiesList}>
                  {STRONG.map((x) => (
                    <li key={x}>· {x}</li>
                  ))}
                </ul>
              </div>
              <div className={s.capabilitiesCol}>
                <h4 style={{ color: 'var(--orange)' }}>Falls flat here</h4>
                <ul className={s.capabilitiesList}>
                  {WEAK.map((x) => (
                    <li key={x}>· {x}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className={s.suggestions}>
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className={s.suggestion}
                onClick={() => setInput(q)}
              >
                {q}
              </button>
            ))}
          </div>

          <div className={s.inputRow}>
            <input
              className={s.input}
              placeholder="Ask the coach…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="button"
              className="btn primary"
              onClick={send}
              disabled={!input.trim()}
            >
              Ask →
            </button>
          </div>

          <p className={s.disclaimer}>
            Coach answers are scoped to this analysis. I won&rsquo;t mix the track for you, but I
            will tell you exactly which knob to turn and how far.
          </p>
        </div>
      </div>
    </section>
  );
}

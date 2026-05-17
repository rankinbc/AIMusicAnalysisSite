import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getAccessToken } from '../../api/fetcher';
import { TranceBot } from './TranceBot';
import s from './CoachChat.module.css';

interface CoachChatProps {
  trackName: string;
  jobId: string;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
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

export function CoachChat({ trackName, jobId }: CoachChatProps) {
  const [input, setInput] = useState('');
  const [showCaps, setShowCaps] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || streaming) return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', text: msg }, { role: 'assistant', text: '' }]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // SSE via fetch + ReadableStream — EventSource can't POST or set
      // Authorization, so we parse `event:` / `data:` frames ourselves.
      const token = getAccessToken();
      const res = await fetch(`/api/coach/${jobId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: msg }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => res.statusText);
        throw new Error(detail || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line.
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = parseFrame(frame);
          if (event.kind === 'chunk') {
            // Server escaped real newlines as \n in the data field; reverse it.
            const text = event.data.replace(/\\n/g, '\n');
            setTurns((t) => {
              const last = t[t.length - 1];
              if (!last || last.role !== 'assistant') return t;
              const copy = t.slice(0, -1);
              copy.push({ role: 'assistant', text: last.text + text });
              return copy;
            });
          } else if (event.kind === 'done') {
            return;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      toast.error(err instanceof Error ? err.message : 'Coach chat failed');
      setTurns((t) => {
        const last = t[t.length - 1];
        if (!last || last.role !== 'assistant' || last.text.length > 0) return t;
        return t.slice(0, -1);  // drop the empty pending message
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, jobId, streaming]);

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
              disabled={!input.trim() || streaming}
            >
              {streaming ? '…' : 'Ask →'}
            </button>
          </div>

          {turns.length > 0 && (
            <div className={s.transcript}>
              {turns.map((turn, i) => (
                <div
                  key={i}
                  className={turn.role === 'user' ? s.turnUser : s.turnAssistant}
                >
                  <span className={s.turnLabel}>
                    {turn.role === 'user' ? 'You' : 'Coach'}
                  </span>
                  <p className={s.turnText}>
                    {turn.text || (streaming && i === turns.length - 1 ? '…' : '')}
                  </p>
                </div>
              ))}
            </div>
          )}

          <p className={s.disclaimer}>
            Coach answers are scoped to this analysis. I won&rsquo;t mix the track for you, but I
            will tell you exactly which knob to turn and how far.
          </p>
        </div>
      </div>
    </section>
  );
}

// Minimal SSE frame parser. The BFF emits `event: chunk\ndata: <text>\n\n`
// followed eventually by `event: done\ndata: {}\n\n`. Anything else is
// ignored.
type SseEvent =
  | { kind: 'chunk'; data: string }
  | { kind: 'done' }
  | { kind: 'other' };

function parseFrame(frame: string): SseEvent {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (event === 'done') return { kind: 'done' };
  if (event === 'chunk') return { kind: 'chunk', data: dataLines.join('\n') };
  return { kind: 'other' };
}

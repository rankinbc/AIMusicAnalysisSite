/* Notes / Listener Feedback tab — the user's own notes + comments and emoji
   reactions gathered when others listen via a share link. Stored per song
   version; surfaced here to reinforce analysis feedback later. */
const { useState: useStateNt } = React;

function NtLabel({ children, hint }) {
  return <div className="nt-label">{children}{hint && <span className="h">· {hint}</span>}</div>;
}

const ntSec = t => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
// Feedback timeline — where in the track reactions and comments landed
function FeedbackTimeline({ fb, dur, durLabel }) {
  const evs = fb.emojiEvents || [];
  const cmts = fb.comments.filter(c => c.at);
  if (!dur || (evs.length === 0 && cmts.length === 0)) return null;
  // density curve: bucket reactions into 40 slots, smooth once
  const N = 40;
  const buckets = new Array(N).fill(0);
  evs.forEach(ev => { buckets[Math.min(N - 1, Math.floor(ntSec(ev.at) / dur * N))] += 1; });
  const sm = buckets.map((v, i) => (v + (buckets[i - 1] || 0) * .5 + (buckets[i + 1] || 0) * .5));
  const mx = Math.max(...sm, 1);
  const W = 100, H = 26;
  const pts = sm.map((v, i) => `${(i + .5) / N * W},${H - 2 - (v / mx) * (H - 5)}`).join(' ');
  return (
    <div className="nt-tl">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <polyline points={`0,${H} ${pts} ${W},${H}`} fill="rgba(0,229,176,.08)" stroke="none" />
        <polyline points={pts} fill="none" stroke="rgba(0,229,176,.45)" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="lane">
        {evs.map((ev, i) => (
          <span className="em" key={'e' + i} style={{ left: `${ntSec(ev.at) / dur * 100}%` }} title={`${ev.e} at ${ev.at}`}>{ev.e}</span>
        ))}
        {cmts.map((c, i) => (
          <span className="cm" key={'c' + i} style={{ left: `${ntSec(c.at) / dur * 100}%` }} title={`${c.name} at ${c.at}: “${c.text}”`}>
            <Icon name="message" size={9} />
          </span>
        ))}
      </div>
      <div className="ax mono"><span>0:00</span><span>{durLabel}</span></div>
    </div>
  );
}

function NotesTab({ scenario }) {
  const fb = scenario.feedback || { notes: [], comments: [], emojis: [] };
  const [notes, setNotes] = useStateNt(fb.notes);
  const [draft, setDraft] = useStateNt('');
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setNotes([{ t: 'Just now', at: null, text }, ...notes]);
    setDraft('');
  };
  const reactions = fb.emojis.reduce((a, x) => a + x.n, 0);
  return (
    <div className="tabbody fade-up">
      <div className="nt-grid">
        <section>
          <NtLabel hint="private to you — saved with this version">My notes</NtLabel>
          <div className="nt-composer">
            <textarea value={draft} placeholder="Note something about this version — what to fix, what to keep, what to A/B next…"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); }} />
            <div className="r">
              <span className="hint mono">⌘↵ to save</span>
              <button className="nt-add" onClick={add} disabled={!draft.trim()}><Icon name="plus" size={12} />Add note</button>
            </div>
          </div>
          {notes.length === 0
            ? <div className="nt-empty">No notes yet.</div>
            : notes.map((n, i) => (
              <div className="nt-note" key={i}>
                <div className="m">
                  {n.at && <span className="at mono" title={`Track position ${n.at}`}><Icon name="clock" size={10} />{n.at}</span>}
                  <span className="when mono">{n.t}</span>
                </div>
                <p>{n.text}</p>
              </div>
            ))}
        </section>
        <section>
          <NtLabel hint="from people you shared this version with">Listener feedback</NtLabel>
          <FeedbackTimeline fb={fb} dur={scenario.track.durationSec} durLabel={scenario.track.duration} />
          {fb.emojis.length > 0 && (
            <div className="nt-emoji">
              {fb.emojis.map((x, i) => (
                <span className="ec" key={i} title={`${x.n} ${x.n === 1 ? 'listener' : 'listeners'} reacted ${x.e}`}>
                  <span className="e">{x.e}</span><span className="n mono">{x.n}</span>
                </span>
              ))}
              <span className="tot mono">{reactions} reactions · {fb.listeners} listeners</span>
            </div>
          )}
          {fb.comments.length === 0
            ? <div className="nt-empty">No listener comments yet — share the track to collect feedback.</div>
            : fb.comments.map((c, i) => (
              <div className="nt-cmt" key={i}>
                <span className="av" aria-hidden="true">{c.name[0].toUpperCase()}</span>
                <div className="b">
                  <div className="m">
                    <span className="nm">{c.name}</span>
                    {c.at && <span className="at mono" title={`Left while listening at ${c.at}`}><Icon name="clock" size={10} />{c.at}</span>}
                    <span className="when mono">{c.when}</span>
                    {c.e && <span className="re" title={`${c.name} reacted ${c.e}`}>{c.e}</span>}
                  </div>
                  <p>{c.text}</p>
                </div>
              </div>
            ))}
          <p className="nt-foot">Feedback is collected while listeners play this version and stays attached to it. It isn't used by the analyzer yet — it's stored so future coaching can weigh what real ears said against the measurements.</p>
        </section>
      </div>
    </div>
  );
}

Object.assign(window, { NotesTab });
